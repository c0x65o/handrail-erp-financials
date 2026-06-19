import type {
  Account,
  AccountClassification,
  AccountingBasis,
  AccountId,
  DecimalString,
  DrilldownRef,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  LedgerPosting,
  LedgerPostingId,
  ReconciliationStatus,
  ReportFreshness,
  ReportSnapshot,
  ReportSnapshotLine,
  ReportSnapshotTotal,
  TenantId
} from "./canonical-model.js";
import { createCompactDrilldownRef } from "./canonical-model.js";

export type ReportName = "profit_and_loss" | "balance_sheet" | "trial_balance" | "cash_flow";
export type ReportSourceKind = "ledger_postings" | "rollup_buckets" | "report_snapshot";
export type CashFlowActivity = "operating" | "investing" | "financing" | "unclassified";
export type CashFlowSupportStatus = "supported" | "partial" | "unsupported";

export type ReportBuilderInput = {
  readonly tenantId: TenantId;
  readonly accounts: readonly Account[];
  readonly postings: readonly LedgerPosting[];
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate?: IsoDate;
  readonly generatedAt?: IsoDateTime;
  readonly freshness?: ReportFreshness;
};

export type CashFlowBuilderInput = ReportBuilderInput & {
  readonly cashAccountIds: readonly AccountId[];
  readonly activityByAccountId: Readonly<Record<AccountId, Exclude<CashFlowActivity, "unclassified">>>;
};

export type CashFlowMetadata = {
  readonly supportStatus: CashFlowSupportStatus;
  readonly derivationMethod: "cash_account_ledger_movement";
  readonly cashAccountIds: readonly AccountId[];
  readonly unsupportedReasons: readonly string[];
  readonly unclassifiedCashMovementPostingIds: readonly LedgerPostingId[];
};

export type ReportBuilderMetadata = {
  readonly reportName: ReportName;
  readonly generatedFrom: ReportSourceKind;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly reconciliationDifference: DecimalString;
  readonly cashFlow?: CashFlowMetadata;
};

export type BuiltReport = {
  readonly snapshot: ReportSnapshot;
  readonly lines: readonly ReportSnapshotLine[];
  readonly totals: readonly ReportSnapshotTotal[];
  readonly metadata: ReportBuilderMetadata;
};

const DEFAULT_GENERATED_AT = "1970-01-01T00:00:00.000Z";
const ZERO = "0.00";

const PROFIT_AND_LOSS_SECTIONS: readonly AccountClassification[] = [
  "income",
  "cost_of_goods_sold",
  "expense",
  "other_income",
  "other_expense"
];

const BALANCE_SHEET_SECTIONS: readonly AccountClassification[] = ["asset", "liability", "equity"];

export function buildProfitAndLossReport(input: ReportBuilderInput): BuiltReport {
  const accountMap = createAccountMap(input.accounts);
  const postings = filterPeriodPostings(input);
  const lines = buildAccountLines({
    input,
    reportName: "profit_and_loss",
    snapshotId: snapshotId("profit_and_loss", input),
    postings,
    accountMap,
    classifications: PROFIT_AND_LOSS_SECTIONS,
    amountForClassification: incomeStatementAmount
  });
  const totalByKey = new Map<string, LineAccumulator>();

  addTotal(totalByKey, "total_income", "Total Income", linesForSection(lines, "income"));
  addTotal(totalByKey, "total_cost_of_goods_sold", "Total Cost of Goods Sold", linesForSection(lines, "cost_of_goods_sold"));
  addTotal(totalByKey, "gross_profit", "Gross Profit", [
    lineAsAccumulator(linesForTotal(totalByKey, "total_income"), 1),
    lineAsAccumulator(linesForTotal(totalByKey, "total_cost_of_goods_sold"), -1)
  ]);
  addTotal(totalByKey, "total_expenses", "Total Expenses", linesForSection(lines, "expense"));
  addTotal(totalByKey, "net_operating_income", "Net Operating Income", [
    lineAsAccumulator(linesForTotal(totalByKey, "gross_profit"), 1),
    lineAsAccumulator(linesForTotal(totalByKey, "total_expenses"), -1)
  ]);
  addTotal(totalByKey, "total_other_income", "Total Other Income", linesForSection(lines, "other_income"));
  addTotal(totalByKey, "total_other_expense", "Total Other Expense", linesForSection(lines, "other_expense"));
  addTotal(totalByKey, "net_income", "Net Income", [
    lineAsAccumulator(linesForTotal(totalByKey, "net_operating_income"), 1),
    lineAsAccumulator(linesForTotal(totalByKey, "total_other_income"), 1),
    lineAsAccumulator(linesForTotal(totalByKey, "total_other_expense"), -1)
  ]);

  return buildReportResult(input, "profit_and_loss", lines, totalsFromMap(input, "profit_and_loss", totalByKey), {
    reconciliationStatus: "not_reconciled",
    reconciliationDifference: ZERO
  });
}

export function buildBalanceSheetReport(input: ReportBuilderInput): BuiltReport {
  const asOfInput = { ...input, periodEnd: input.asOfDate ?? input.periodEnd };
  const accountMap = createAccountMap(input.accounts);
  const postings = filterAsOfPostings(asOfInput);
  const snapshot = snapshotId("balance_sheet", input);
  const accountLines = buildAccountLines({
    input,
    reportName: "balance_sheet",
    snapshotId: snapshot,
    postings,
    accountMap,
    classifications: BALANCE_SHEET_SECTIONS,
    amountForClassification: balanceSheetAmount
  });
  const currentEarnings = currentEarningsAccumulator(input, accountMap);
  const lines = [...accountLines];

  if (currentEarnings.amountMinor !== 0n) {
    lines.push({
      tenantId: input.tenantId,
      reportSnapshotId: snapshot,
      reportLineId: lineId("balance_sheet", lines.length + 1, "current_earnings"),
      section: "equity",
      label: "Current Period Earnings",
      amount: formatMoney(currentEarnings.amountMinor),
      sortOrder: (lines.length + 1) * 10,
      drilldownRef: drilldownRef(
        "balance_sheet",
        currentEarnings.key,
        currentEarnings.postingIds,
        currentEarnings.accountIds
      )
    });
  }

  const totalAssets = sumLineAmounts(linesForSection(lines, "asset"));
  const totalLiabilities = sumLineAmounts(linesForSection(lines, "liability"));
  const totalEquity = sumLineAmounts(linesForSection(lines, "equity"));
  const liabilitiesAndEquity = totalLiabilities + totalEquity;
  const reconciliationDifference = totalAssets - liabilitiesAndEquity;
  const totals = [
    totalFromLines(input, "balance_sheet", "total_assets", "Total Assets", linesForSection(lines, "asset")),
    totalFromLines(input, "balance_sheet", "total_liabilities", "Total Liabilities", linesForSection(lines, "liability")),
    totalFromLines(input, "balance_sheet", "total_equity", "Total Equity", linesForSection(lines, "equity")),
    totalFromAccumulator(input, "balance_sheet", {
      key: "total_liabilities_and_equity",
      label: "Total Liabilities and Equity",
      amountMinor: liabilitiesAndEquity,
      postingIds: mergePostingIds(linesForSection(lines, "liability"), linesForSection(lines, "equity")),
      accountIds: mergeAccountIds(linesForSection(lines, "liability"), linesForSection(lines, "equity"))
    })
  ];

  return buildReportResult(input, "balance_sheet", lines, totals, {
    reconciliationStatus: reconciliationDifference === 0n ? "balanced" : "out_of_balance",
    reconciliationDifference: formatMoney(reconciliationDifference)
  });
}

export function buildTrialBalanceReport(input: ReportBuilderInput): BuiltReport {
  const accountMap = createAccountMap(input.accounts);
  const postings = filterAsOfPostings(input);
  const balances = aggregateByAccount(postings, accountMap, signedDebitMinusCredit);
  const snapshot = snapshotId("trial_balance", input);
  const lines = [...balances.values()]
    .filter((balance) => balance.amountMinor !== 0n)
    .sort(compareAccountBalances)
    .map((balance, index): ReportSnapshotLine => ({
      tenantId: input.tenantId,
      reportSnapshotId: snapshot,
      reportLineId: lineId("trial_balance", index + 1, balance.account.accountId),
      section: balance.amountMinor >= 0n ? "debit" : "credit",
      label: accountLabel(balance.account),
      accountId: balance.account.accountId,
      amount: formatMoney(balance.amountMinor),
      sortOrder: (index + 1) * 10,
      drilldownRef: drilldownRef("trial_balance", balance.account.accountId, balance.postingIds, [balance.account.accountId])
    }));
  const debitTotal = lines.reduce((sum, line) => (parseMoney(line.amount) > 0n ? sum + parseMoney(line.amount) : sum), 0n);
  const creditTotal = lines.reduce((sum, line) => (parseMoney(line.amount) < 0n ? sum - parseMoney(line.amount) : sum), 0n);
  const difference = debitTotal - creditTotal;
  const totals = [
    totalFromAccumulator(input, "trial_balance", {
      key: "total_debits",
      label: "Total Debits",
      amountMinor: debitTotal,
      postingIds: postingIdsFromReportLines(lines),
      accountIds: accountIdsFromReportLines(lines)
    }),
    totalFromAccumulator(input, "trial_balance", {
      key: "total_credits",
      label: "Total Credits",
      amountMinor: creditTotal,
      postingIds: postingIdsFromReportLines(lines),
      accountIds: accountIdsFromReportLines(lines)
    })
  ];

  return buildReportResult(input, "trial_balance", lines, totals, {
    reconciliationStatus: difference === 0n ? "balanced" : "out_of_balance",
    reconciliationDifference: formatMoney(difference)
  });
}

export function buildCashFlowReport(input: CashFlowBuilderInput): BuiltReport {
  const cashAccountIds = new Set(input.cashAccountIds);
  const periodPostings = filterPeriodPostings(input);
  const cashPostings = periodPostings.filter((posting) => cashAccountIds.has(posting.accountId));
  const beginningCashPostings = filterBeforeDatePostings(input).filter((posting) => cashAccountIds.has(posting.accountId));
  const beginningCash = beginningCashPostings.reduce(
    (sum, posting) => sum + signedDebitMinusCredit(posting),
    0n
  );
  const activityTotals: Record<CashFlowActivity, CashFlowAccumulator> = {
    operating: emptyCashFlowAccumulator("operating"),
    investing: emptyCashFlowAccumulator("investing"),
    financing: emptyCashFlowAccumulator("financing"),
    unclassified: emptyCashFlowAccumulator("unclassified")
  };
  const postingsByTransaction = groupBy(periodPostings, (posting) => posting.transactionId);

  for (const cashPosting of cashPostings) {
    const activity = classifyCashPosting(cashPosting, postingsByTransaction, cashAccountIds, input.activityByAccountId);
    const cashMovement = signedDebitMinusCredit(cashPosting);
    activityTotals[activity].amountMinor += cashMovement;
    activityTotals[activity].postingIds.push(cashPosting.postingId);
    activityTotals[activity].accountIds.add(cashPosting.accountId);
  }

  const netCashFlow =
    activityTotals.operating.amountMinor +
    activityTotals.investing.amountMinor +
    activityTotals.financing.amountMinor +
    activityTotals.unclassified.amountMinor;
  const endingCash = beginningCash + netCashFlow;
  const snapshot = snapshotId("cash_flow", input);
  const lines = (["operating", "investing", "financing", "unclassified"] as const)
    .filter((activity) => activityTotals[activity].amountMinor !== 0n)
    .map((activity, index): ReportSnapshotLine => ({
      tenantId: input.tenantId,
      reportSnapshotId: snapshot,
      reportLineId: lineId("cash_flow", index + 1, activity),
      section: activity,
      label: cashFlowLabel(activity),
      amount: formatMoney(activityTotals[activity].amountMinor),
      sortOrder: (index + 1) * 10,
      drilldownRef: drilldownRef(
        "cash_flow",
        activity,
        activityTotals[activity].postingIds,
        [...activityTotals[activity].accountIds]
      )
    }));
  const totals = [
    cashTotal(
      input,
      "cash_beginning",
      "Cash at Beginning of Period",
      beginningCash,
      input.cashAccountIds,
      beginningCashPostings.map((posting) => posting.postingId)
    ),
    cashTotal(input, "net_operating_cash", "Net Cash from Operating Activities", activityTotals.operating.amountMinor, [
      ...activityTotals.operating.accountIds
    ], activityTotals.operating.postingIds),
    cashTotal(input, "net_investing_cash", "Net Cash from Investing Activities", activityTotals.investing.amountMinor, [
      ...activityTotals.investing.accountIds
    ], activityTotals.investing.postingIds),
    cashTotal(input, "net_financing_cash", "Net Cash from Financing Activities", activityTotals.financing.amountMinor, [
      ...activityTotals.financing.accountIds
    ], activityTotals.financing.postingIds),
    cashTotal(input, "unclassified_cash_movement", "Unclassified Cash Movement", activityTotals.unclassified.amountMinor, [
      ...activityTotals.unclassified.accountIds
    ], activityTotals.unclassified.postingIds),
    cashTotal(input, "net_cash_flow", "Net Change in Cash", netCashFlow, input.cashAccountIds, cashPostings.map((posting) => posting.postingId)),
    cashTotal(input, "cash_ending", "Cash at End of Period", endingCash, input.cashAccountIds, cashPostings.map((posting) => posting.postingId))
  ];
  const unsupportedReasons =
    input.cashAccountIds.length === 0
      ? ["cash_flow_requires_cash_account_ids"]
      : activityTotals.unclassified.amountMinor === 0n
        ? []
        : ["cash_flow_has_unclassified_cash_movement"];

  return buildReportResult(input, "cash_flow", lines, totals, {
    reconciliationStatus: "not_reconciled",
    reconciliationDifference: ZERO,
    cashFlow: {
      supportStatus:
        input.cashAccountIds.length === 0 ? "unsupported" : activityTotals.unclassified.amountMinor === 0n ? "supported" : "partial",
      derivationMethod: "cash_account_ledger_movement",
      cashAccountIds: input.cashAccountIds,
      unsupportedReasons,
      unclassifiedCashMovementPostingIds: [...activityTotals.unclassified.postingIds].sort()
    }
  });
}

function buildReportResult(
  input: ReportBuilderInput,
  reportName: ReportName,
  lines: readonly ReportSnapshotLine[],
  totals: readonly ReportSnapshotTotal[],
  metadata: Omit<ReportBuilderMetadata, "reportName" | "generatedFrom">
): BuiltReport {
  return {
    snapshot: {
      tenantId: input.tenantId,
      reportSnapshotId: snapshotId(reportName, input),
      reportName,
      snapshotSource: "builder",
      accountingBasis: input.accountingBasis,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      asOfDate: input.asOfDate ?? input.periodEnd,
      currencyCode: input.currencyCode,
      generatedAt: input.generatedAt ?? DEFAULT_GENERATED_AT,
      freshness: input.freshness ?? { status: "unknown" },
      reconciliationStatus: metadata.reconciliationStatus,
      reconciliationDifference: metadata.reconciliationDifference
    },
    lines,
    totals,
    metadata: {
      reportName,
      generatedFrom: "ledger_postings",
      ...metadata
    }
  };
}

type AccountBalance = {
  readonly account: Account;
  amountMinor: bigint;
  readonly postingIds: LedgerPostingId[];
};

type BuildAccountLinesInput = {
  readonly input: ReportBuilderInput;
  readonly reportName: ReportName;
  readonly snapshotId: string;
  readonly postings: readonly LedgerPosting[];
  readonly accountMap: ReadonlyMap<AccountId, Account>;
  readonly classifications: readonly AccountClassification[];
  readonly amountForClassification: (posting: LedgerPosting, classification: AccountClassification) => bigint;
};

function buildAccountLines(buildInput: BuildAccountLinesInput): ReportSnapshotLine[] {
  const balances = aggregateByAccount(
    buildInput.postings,
    buildInput.accountMap,
    (posting, account) => buildInput.amountForClassification(posting, account.classification)
  );

  return [...balances.values()]
    .filter((balance) => balance.amountMinor !== 0n && buildInput.classifications.includes(balance.account.classification))
    .sort((left, right) => compareStatementAccountBalances(left, right, buildInput.classifications))
    .map((balance, index): ReportSnapshotLine => ({
      tenantId: buildInput.input.tenantId,
      reportSnapshotId: buildInput.snapshotId,
      reportLineId: lineId(buildInput.reportName, index + 1, balance.account.accountId),
      section: balance.account.classification,
      label: accountLabel(balance.account),
      accountId: balance.account.accountId,
      amount: formatMoney(balance.amountMinor),
      sortOrder: (index + 1) * 10,
      drilldownRef: drilldownRef(buildInput.reportName, balance.account.accountId, balance.postingIds, [balance.account.accountId])
    }));
}

function aggregateByAccount(
  postings: readonly LedgerPosting[],
  accountMap: ReadonlyMap<AccountId, Account>,
  amountForPosting: (posting: LedgerPosting, account: Account) => bigint
): Map<AccountId, AccountBalance> {
  const balances = new Map<AccountId, AccountBalance>();

  for (const posting of postings) {
    const account = accountMap.get(posting.accountId);
    if (account === undefined) {
      continue;
    }
    const existing = balances.get(account.accountId);
    if (existing === undefined) {
      balances.set(account.accountId, {
        account,
        amountMinor: amountForPosting(posting, account),
        postingIds: [posting.postingId]
      });
    } else {
      existing.amountMinor += amountForPosting(posting, account);
      existing.postingIds.push(posting.postingId);
    }
  }

  return balances;
}

function currentEarningsAccumulator(input: ReportBuilderInput, accountMap: ReadonlyMap<AccountId, Account>): LineAccumulator {
  const postings = filterPeriodPostings(input);
  const relevant = postings.filter((posting) => {
    const account = accountMap.get(posting.accountId);
    return account !== undefined && PROFIT_AND_LOSS_SECTIONS.includes(account.classification);
  });
  const amountMinor = relevant.reduce((sum, posting) => {
    const account = accountMap.get(posting.accountId);
    if (account === undefined) {
      return sum;
    }
    const statementAmount = incomeStatementAmount(posting, account.classification);
    return account.classification === "income" || account.classification === "other_income"
      ? sum + statementAmount
      : sum - statementAmount;
  }, 0n);

  return {
    key: "current_period_earnings",
    label: "Current Period Earnings",
    amountMinor,
    postingIds: relevant.map((posting) => posting.postingId),
    accountIds: unique(relevant.map((posting) => posting.accountId))
  };
}

function createAccountMap(accounts: readonly Account[]): ReadonlyMap<AccountId, Account> {
  return new Map(accounts.map((account) => [account.accountId, account]));
}

function filterPeriodPostings(input: ReportBuilderInput): LedgerPosting[] {
  return input.postings
    .filter(
      (posting) =>
        posting.tenantId === input.tenantId &&
        posting.accountingBasis === input.accountingBasis &&
        posting.currencyCode === input.currencyCode &&
        posting.postingDate >= input.periodStart &&
        posting.postingDate <= input.periodEnd
    )
    .sort(comparePostings);
}

function filterAsOfPostings(input: ReportBuilderInput): LedgerPosting[] {
  const asOfDate = input.asOfDate ?? input.periodEnd;
  return input.postings
    .filter(
      (posting) =>
        posting.tenantId === input.tenantId &&
        posting.accountingBasis === input.accountingBasis &&
        posting.currencyCode === input.currencyCode &&
        posting.postingDate <= asOfDate
    )
    .sort(comparePostings);
}

function filterBeforeDatePostings(input: ReportBuilderInput): LedgerPosting[] {
  return input.postings
    .filter(
      (posting) =>
        posting.tenantId === input.tenantId &&
        posting.accountingBasis === input.accountingBasis &&
        posting.currencyCode === input.currencyCode &&
        posting.postingDate < input.periodStart
    )
    .sort(comparePostings);
}

function incomeStatementAmount(posting: LedgerPosting, classification: AccountClassification): bigint {
  const debitMinusCredit = signedDebitMinusCredit(posting);
  return classification === "income" || classification === "other_income" ? -debitMinusCredit : debitMinusCredit;
}

function balanceSheetAmount(posting: LedgerPosting, classification: AccountClassification): bigint {
  const debitMinusCredit = signedDebitMinusCredit(posting);
  return classification === "asset" ? debitMinusCredit : -debitMinusCredit;
}

function signedDebitMinusCredit(posting: LedgerPosting): bigint {
  return parseMoney(posting.debitAmount) - parseMoney(posting.creditAmount);
}

function parseMoney(value: DecimalString): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[2] === undefined) {
    throw new Error(`Decimal value must have at most two fractional digits: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100n + fraction);
}

function formatMoney(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

type LineAccumulator = {
  readonly key: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly postingIds: readonly LedgerPostingId[];
  readonly accountIds: readonly AccountId[];
};

function addTotal(target: Map<string, LineAccumulator>, key: string, label: string, inputs: readonly LineAccumulator[]): void {
  target.set(key, {
    key,
    label,
    amountMinor: inputs.reduce((sum, input) => sum + input.amountMinor, 0n),
    postingIds: unique(inputs.flatMap((input) => input.postingIds)),
    accountIds: unique(inputs.flatMap((input) => input.accountIds))
  });
}

function linesForSection(lines: readonly ReportSnapshotLine[], section: string): LineAccumulator[] {
  return lines
    .filter((line) => line.section === section)
    .map((line) => ({
      key: line.reportLineId,
      label: line.label,
      amountMinor: parseMoney(line.amount),
      postingIds: line.drilldownRef.postingIds ?? [],
      accountIds: line.drilldownRef.accountIds ?? []
    }));
}

function linesForTotal(totals: ReadonlyMap<string, LineAccumulator>, key: string): LineAccumulator {
  const total = totals.get(key);
  if (total === undefined) {
    throw new Error(`Report total was not built: ${key}`);
  }
  return total;
}

function lineAsAccumulator(input: LineAccumulator, multiplier: 1 | -1): LineAccumulator {
  return {
    ...input,
    amountMinor: input.amountMinor * BigInt(multiplier)
  };
}

function totalsFromMap(input: ReportBuilderInput, reportName: ReportName, totals: ReadonlyMap<string, LineAccumulator>): ReportSnapshotTotal[] {
  return [...totals.values()].map((total) => totalFromAccumulator(input, reportName, total));
}

function totalFromLines(
  input: ReportBuilderInput,
  reportName: ReportName,
  key: string,
  label: string,
  lines: readonly LineAccumulator[]
): ReportSnapshotTotal {
  return totalFromAccumulator(input, reportName, {
    key,
    label,
    amountMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0n),
    postingIds: unique(lines.flatMap((line) => line.postingIds)),
    accountIds: unique(lines.flatMap((line) => line.accountIds))
  });
}

function totalFromAccumulator(input: ReportBuilderInput, reportName: ReportName, total: LineAccumulator): ReportSnapshotTotal {
  return {
    tenantId: input.tenantId,
    reportSnapshotId: snapshotId(reportName, input),
    reportTotalId: totalId(reportName, total.key),
    totalKey: total.key,
    label: total.label,
    amount: formatMoney(total.amountMinor),
    drilldownRef: drilldownRef(reportName, total.key, total.postingIds, total.accountIds)
  };
}

function cashTotal(
  input: ReportBuilderInput,
  key: string,
  label: string,
  amountMinor: bigint,
  accountIds: readonly AccountId[],
  postingIds: readonly LedgerPostingId[]
): ReportSnapshotTotal {
  return totalFromAccumulator(input, "cash_flow", {
    key,
    label,
    amountMinor,
    accountIds,
    postingIds
  });
}

function sumLineAmounts(lines: readonly LineAccumulator[]): bigint {
  return lines.reduce((sum, line) => sum + line.amountMinor, 0n);
}

function mergePostingIds(left: readonly LineAccumulator[], right: readonly LineAccumulator[] = []): LedgerPostingId[] {
  return unique([...left, ...right].flatMap((line) => line.postingIds));
}

function mergeAccountIds(left: readonly LineAccumulator[], right: readonly LineAccumulator[] = []): AccountId[] {
  return unique([...left, ...right].flatMap((line) => line.accountIds));
}

function postingIdsFromReportLines(lines: readonly ReportSnapshotLine[]): LedgerPostingId[] {
  return unique(lines.flatMap((line) => line.drilldownRef.postingIds ?? []));
}

function accountIdsFromReportLines(lines: readonly ReportSnapshotLine[]): AccountId[] {
  return unique(lines.flatMap((line) => line.drilldownRef.accountIds ?? []));
}

function drilldownRef(
  reportName: ReportName,
  key: string,
  postingIds: readonly LedgerPostingId[],
  accountIds: readonly AccountId[]
): DrilldownRef {
  return createCompactDrilldownRef({
    token: `${reportName}:${key}`,
    postingIds: unique(postingIds),
    accountIds: unique(accountIds),
    query: {
      kind: "ledger_postings",
      accountIds: unique(accountIds)
    }
  });
}

function snapshotId(reportName: ReportName, input: ReportBuilderInput): string {
  return [
    "snapshot",
    input.tenantId,
    reportName,
    input.accountingBasis,
    input.periodStart,
    input.periodEnd,
    input.asOfDate ?? input.periodEnd,
    input.currencyCode
  ].join(":");
}

function lineId(reportName: ReportName, index: number, key: string): string {
  return `${reportName}:line:${index.toString().padStart(3, "0")}:${key}`;
}

function totalId(reportName: ReportName, key: string): string {
  return `${reportName}:total:${key}`;
}

function accountLabel(account: Account): string {
  return account.accountNumber === undefined ? account.name : `${account.accountNumber} ${account.name}`;
}

function compareAccountBalances(left: AccountBalance, right: AccountBalance): number {
  return (
    left.account.classification.localeCompare(right.account.classification) ||
    (left.account.accountNumber ?? "").localeCompare(right.account.accountNumber ?? "") ||
    left.account.name.localeCompare(right.account.name) ||
    left.account.accountId.localeCompare(right.account.accountId)
  );
}

function compareStatementAccountBalances(
  left: AccountBalance,
  right: AccountBalance,
  classifications: readonly AccountClassification[]
): number {
  return (
    classifications.indexOf(left.account.classification) - classifications.indexOf(right.account.classification) ||
    (left.account.accountNumber ?? "").localeCompare(right.account.accountNumber ?? "") ||
    left.account.name.localeCompare(right.account.name) ||
    left.account.accountId.localeCompare(right.account.accountId)
  );
}

function comparePostings(left: LedgerPosting, right: LedgerPosting): number {
  return (
    left.postingDate.localeCompare(right.postingDate) ||
    left.transactionId.localeCompare(right.transactionId) ||
    left.postingId.localeCompare(right.postingId)
  );
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

type CashFlowAccumulator = {
  readonly activity: CashFlowActivity;
  amountMinor: bigint;
  readonly postingIds: LedgerPostingId[];
  readonly accountIds: Set<AccountId>;
};

function emptyCashFlowAccumulator(activity: CashFlowActivity): CashFlowAccumulator {
  return {
    activity,
    amountMinor: 0n,
    postingIds: [],
    accountIds: new Set<AccountId>()
  };
}

function classifyCashPosting(
  cashPosting: LedgerPosting,
  postingsByTransaction: ReadonlyMap<string, readonly LedgerPosting[]>,
  cashAccountIds: ReadonlySet<AccountId>,
  activityByAccountId: Readonly<Record<AccountId, Exclude<CashFlowActivity, "unclassified">>>
): CashFlowActivity {
  const transactionPostings = postingsByTransaction.get(cashPosting.transactionId) ?? [];
  const activities = unique(
    transactionPostings
      .filter((posting) => posting.postingId !== cashPosting.postingId && !cashAccountIds.has(posting.accountId))
      .map((posting) => activityByAccountId[posting.accountId])
      .filter((activity): activity is Exclude<CashFlowActivity, "unclassified"> => activity !== undefined)
  );

  const onlyActivity = activities[0];
  return activities.length === 1 && onlyActivity !== undefined ? onlyActivity : "unclassified";
}

function groupBy<T>(values: readonly T[], keyForValue: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyForValue(value);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, [value]);
    } else {
      existing.push(value);
    }
  }
  return grouped;
}

function cashFlowLabel(activity: CashFlowActivity): string {
  switch (activity) {
    case "operating":
      return "Net Cash from Operating Activities";
    case "investing":
      return "Net Cash from Investing Activities";
    case "financing":
      return "Net Cash from Financing Activities";
    case "unclassified":
      return "Unclassified Cash Movement";
  }
}
