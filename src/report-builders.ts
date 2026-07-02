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
  SafeSourcePayloadRef,
  SourceId,
  TenantId
} from "./canonical-model.js";
import { buildAccountHierarchyRollupLines } from "./account-hierarchy-rollup-lines.js";
import { assertValidAccountHierarchy } from "./account-hierarchy.js";
import { assertLedgerPostingAmounts, assertSafeSourcePayloadRef, createCompactDrilldownRef } from "./canonical-model.js";

import type { AccountHierarchyRollupLineAmount } from "./account-hierarchy-rollup-lines.js";

export type ReportName = "profit_and_loss" | "balance_sheet" | "trial_balance" | "cash_flow";
export type ReportSourceKind = "ledger_postings" | "rollup_buckets" | "report_snapshot";
export type CashFlowActivity = "operating" | "investing" | "financing" | "unclassified";
export type CashFlowSupportStatus = "supported" | "partial" | "unsupported";
export type CashFlowMethod = "direct" | "indirect";
export type CashFlowDerivationMethod =
  | "cash_account_ledger_movement"
  | "indirect_net_income_adjustments";

/**
 * Raw-posting formula input for fixture/reference report builders.
 *
 * These helpers are intended for deterministic fixtures, smoke tests, snapshot
 * refresh/rebuild, and bounded repair flows. Production standard-report
 * presentation should use snapshots, rollups, SQL aggregates, or
 * buildStandardReportPresentationFromReadModel instead of scanning raw postings
 * to build multi-column presentation rows.
 */
export type ReportBuilderInput = {
  readonly tenantId: TenantId;
  readonly accounts: readonly Account[];
  readonly postings: readonly LedgerPosting[];
  readonly accountingBasis: AccountingBasis;
  readonly sourceId?: SourceId;
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
  readonly derivationMethod: CashFlowDerivationMethod;
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
const TRIAL_BALANCE_ACCOUNT_SECTIONS: readonly AccountClassification[] = [
  "asset",
  "cost_of_goods_sold",
  "equity",
  "expense",
  "income",
  "liability",
  "other_expense",
  "other_income"
];
const ACCOUNT_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  ...PROFIT_AND_LOSS_SECTIONS,
  ...BALANCE_SHEET_SECTIONS
]);

/**
 * Builds the P&L formula from canonical postings for fixture/reference flows.
 * Not the production standard-report presentation path.
 */
export function buildProfitAndLossReport(input: ReportBuilderInput): BuiltReport {
  assertReportBuilderInputComplete(input);
  const accountMap = createAccountMap(input);
  const postings = filterPeriodPostings(input);
  const snapshot = snapshotId("profit_and_loss", input);
  const directBalances = aggregateByAccount(
    postings,
    accountMap,
    (posting, account) => incomeStatementAmount(posting, account.classification)
  );
  const profitAndLossAccounts = [...accountMap.values()].filter((account) =>
    PROFIT_AND_LOSS_SECTIONS.includes(account.classification)
  );
  const directAmounts = accountHierarchyAmountsForBalances(directBalances, PROFIT_AND_LOSS_SECTIONS);
  const directAccumulators = accumulatorsForAccountBalances(directBalances, PROFIT_AND_LOSS_SECTIONS);
  const lines = buildAccountHierarchyRollupLines({
    tenantId: input.tenantId,
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    reportSnapshotId: snapshot,
    reportName: "profit_and_loss",
    accounts: profitAndLossAccounts,
    accountAmounts: directAmounts,
    sectionOrder: PROFIT_AND_LOSS_SECTIONS,
    drilldownQuery: {
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      accountingBasis: input.accountingBasis,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd
    }
  });
  const totalByKey = new Map<string, LineAccumulator>();

  addTotal(totalByKey, "total_income", "Total Income", accumulatorsForSection(directAccumulators, "income"));
  addTotal(
    totalByKey,
    "total_cost_of_goods_sold",
    "Total Cost of Goods Sold",
    accumulatorsForSection(directAccumulators, "cost_of_goods_sold")
  );
  addTotal(totalByKey, "gross_profit", "Gross Profit", [
    lineAsAccumulator(linesForTotal(totalByKey, "total_income"), 1),
    lineAsAccumulator(linesForTotal(totalByKey, "total_cost_of_goods_sold"), -1)
  ]);
  addTotal(totalByKey, "total_expenses", "Total Expenses", accumulatorsForSection(directAccumulators, "expense"));
  addTotal(totalByKey, "net_operating_income", "Net Operating Income", [
    lineAsAccumulator(linesForTotal(totalByKey, "gross_profit"), 1),
    lineAsAccumulator(linesForTotal(totalByKey, "total_expenses"), -1)
  ]);
  addTotal(totalByKey, "total_other_income", "Total Other Income", accumulatorsForSection(directAccumulators, "other_income"));
  addTotal(totalByKey, "total_other_expense", "Total Other Expense", accumulatorsForSection(directAccumulators, "other_expense"));
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

/**
 * Builds the balance sheet formula from canonical postings for fixture/reference
 * flows. Not the production standard-report presentation path.
 */
export function buildBalanceSheetReport(input: ReportBuilderInput): BuiltReport {
  assertReportBuilderInputComplete(input);
  const asOfInput = { ...input, periodEnd: input.asOfDate ?? input.periodEnd };
  const accountMap = createAccountMap(input);
  const postings = filterAsOfPostings(asOfInput);
  const snapshot = snapshotId("balance_sheet", input);
  const directBalances = aggregateByAccount(
    postings,
    accountMap,
    (posting, account) => balanceSheetAmount(posting, account.classification)
  );
  const balanceSheetAccounts = [...accountMap.values()].filter((account) =>
    BALANCE_SHEET_SECTIONS.includes(account.classification)
  );
  const directAmounts = accountHierarchyAmountsForBalances(directBalances, BALANCE_SHEET_SECTIONS);
  const directAccumulators = accumulatorsForAccountBalances(directBalances, BALANCE_SHEET_SECTIONS);
  const accountLines = buildAccountHierarchyRollupLines({
    tenantId: input.tenantId,
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    reportSnapshotId: snapshot,
    reportName: "balance_sheet",
    accounts: balanceSheetAccounts,
    accountAmounts: directAmounts,
    sectionOrder: BALANCE_SHEET_SECTIONS,
    drilldownQuery: {
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      accountingBasis: input.accountingBasis,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd
    }
  });
  // GAAP equity roll-forward matching provider (QuickBooks) presentation:
  // income-statement activity before the report period accumulates into
  // "Retained Earnings"; in-period activity is presented as "Net Income".
  // Together they close all P&L postings through the as-of date into equity,
  // so the balance sheet ties for any reporting period.
  const balanceSheetAsOfDate = input.asOfDate ?? input.periodEnd;
  const retainedEarnings = earningsAccumulator(input, accountMap, {
    before: input.periodStart,
    key: "retained_earnings",
    label: "Retained Earnings"
  });
  const netIncomeEarnings = earningsAccumulator(input, accountMap, {
    from: input.periodStart,
    through: balanceSheetAsOfDate,
    key: "net_income",
    label: "Net Income"
  });
  const lines = [...accountLines];
  const equityAccumulators = [...accumulatorsForSection(directAccumulators, "equity")];

  for (const earnings of [retainedEarnings, netIncomeEarnings]) {
    if (earnings.amountMinor === 0n) {
      continue;
    }
    equityAccumulators.push(earnings);
    lines.push({
      tenantId: input.tenantId,
      reportSnapshotId: snapshot,
      reportLineId: lineId("balance_sheet", lines.length + 1, earnings.key),
      section: "equity",
      label: earnings.label,
      amount: formatMoney(earnings.amountMinor),
      sortOrder: (lines.length + 1) * 10,
      drilldownRef: drilldownRef(
        input,
        "balance_sheet",
        earnings.key,
        earnings.postingIds,
        earnings.accountIds,
        earnings.sourceRefs
      )
    });
  }

  const assetAccumulators = accumulatorsForSection(directAccumulators, "asset");
  const liabilityAccumulators = accumulatorsForSection(directAccumulators, "liability");
  const totalAssets = sumLineAmounts(assetAccumulators);
  const totalLiabilities = sumLineAmounts(liabilityAccumulators);
  const totalEquity = sumLineAmounts(equityAccumulators);
  const liabilitiesAndEquity = totalLiabilities + totalEquity;
  const reconciliationDifference = totalAssets - liabilitiesAndEquity;
  const totals = [
    totalFromLines(input, "balance_sheet", "total_assets", "Total Assets", assetAccumulators),
    totalFromLines(input, "balance_sheet", "total_liabilities", "Total Liabilities", liabilityAccumulators),
    totalFromLines(input, "balance_sheet", "total_equity", "Total Equity", equityAccumulators),
    totalFromAccumulator(input, "balance_sheet", {
      key: "total_liabilities_and_equity",
      label: "Total Liabilities and Equity",
      amountMinor: liabilitiesAndEquity,
      postingIds: mergePostingIds(liabilityAccumulators, equityAccumulators),
      accountIds: mergeAccountIds(liabilityAccumulators, equityAccumulators),
      sourceRefs: mergeSourceRefs(liabilityAccumulators, equityAccumulators)
    })
  ];

  return buildReportResult(input, "balance_sheet", lines, totals, {
    reconciliationStatus: reconciliationDifference === 0n ? "balanced" : "out_of_balance",
    reconciliationDifference: formatMoney(reconciliationDifference)
  });
}

/**
 * Builds the trial balance formula from canonical postings for fixture/reference
 * flows. Not the production standard-report presentation path.
 */
export function buildTrialBalanceReport(input: ReportBuilderInput): BuiltReport {
  assertReportBuilderInputComplete(input);
  const accountMap = createAccountMap(input);
  const postings = filterAsOfPostings(input);
  const directBalances = aggregateByAccount(postings, accountMap, signedDebitMinusCredit);
  const snapshot = snapshotId("trial_balance", input);
  const directAmounts = accountHierarchyAmountsForBalances(directBalances, TRIAL_BALANCE_ACCOUNT_SECTIONS);
  const lines = buildAccountHierarchyRollupLines({
    tenantId: input.tenantId,
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    reportSnapshotId: snapshot,
    reportName: "trial_balance",
    accounts: [...accountMap.values()],
    accountAmounts: directAmounts,
    sectionOrder: TRIAL_BALANCE_ACCOUNT_SECTIONS,
    sectionForAccount: (account) => account.classification,
    drilldownQuery: {
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      accountingBasis: input.accountingBasis,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd
    }
  }).map((line): ReportSnapshotLine => ({
    ...line,
    section: parseMoney(line.amount) >= 0n ? "debit" : "credit"
  }));
  const directAccumulators = accumulatorsForAccountBalances(directBalances, TRIAL_BALANCE_ACCOUNT_SECTIONS);
  const debitAccumulators = directAccumulators.filter((accumulator) => accumulator.amountMinor > 0n);
  const creditAccumulators = directAccumulators
    .filter((accumulator) => accumulator.amountMinor < 0n)
    .map((accumulator): LineAccumulator => ({ ...accumulator, amountMinor: -accumulator.amountMinor }));
  const debitTotal = sumLineAmounts(debitAccumulators);
  const creditTotal = sumLineAmounts(creditAccumulators);
  const difference = debitTotal - creditTotal;
  const totals = [
    totalFromLines(input, "trial_balance", "total_debits", "Total Debits", debitAccumulators),
    totalFromLines(input, "trial_balance", "total_credits", "Total Credits", creditAccumulators)
  ];

  return buildReportResult(input, "trial_balance", lines, totals, {
    reconciliationStatus: difference === 0n ? "balanced" : "out_of_balance",
    reconciliationDifference: formatMoney(difference)
  });
}

/**
 * Builds the cash-flow formula from canonical postings for fixture/reference
 * flows and bounded snapshot refresh/rebuild. Not the production standard-report
 * presentation path.
 */
export function buildCashFlowReport(input: CashFlowBuilderInput): BuiltReport {
  assertReportBuilderInputComplete(input);
  const accountMap = createAccountMap(input);
  const cashAccountIds = expandAccountIdsToDescendants(input.cashAccountIds, accountMap);
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
    const activity = classifyCashPosting(cashPosting, postingsByTransaction, cashAccountIds, accountMap, input.activityByAccountId);
    const cashMovement = signedDebitMinusCredit(cashPosting);
    activityTotals[activity].amountMinor += cashMovement;
    activityTotals[activity].postingIds.push(cashPosting.postingId);
    activityTotals[activity].accountIds.add(cashPosting.accountId);
    activityTotals[activity].sourceRefs.push(...sourceRefsFromPostings([cashPosting]));
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
        input,
        "cash_flow",
        activity,
        activityTotals[activity].postingIds,
        [...activityTotals[activity].accountIds],
        activityTotals[activity].sourceRefs
      )
    }));
  const totals = [
    cashTotal(
      input,
      "cash_beginning",
      "Cash at Beginning of Period",
      beginningCash,
      [...cashAccountIds],
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
    cashTotal(input, "net_cash_flow", "Net Change in Cash", netCashFlow, [...cashAccountIds], cashPostings.map((posting) => posting.postingId)),
    cashTotal(input, "cash_ending", "Cash at End of Period", endingCash, [...cashAccountIds], cashPostings.map((posting) => posting.postingId))
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

const INVESTING_ASSET_PATTERN =
  /fixed|property|plant|equipment|land|building|vehicle|machinery|furniture|leasehold|accumulated[ _-]?depreciation|depletable|intangible|goodwill|long[ _-]?term|investment|security[ _-]?deposit|other[ _-]?asset/i;
const FINANCING_LIABILITY_PATTERN =
  /long[ _-]?term|note|loan|mortgage|debt|bond|shareholder|director|line[ _-]?of[ _-]?credit/i;

/**
 * GAAP-standard default operating/investing/financing classification for
 * balance-sheet accounts on the indirect cash flow statement:
 * working-capital assets and current liabilities adjust operating cash,
 * long-lived assets are investing, debt and equity are financing.
 * Host-supplied activity maps override these defaults per account.
 */
export function defaultCashFlowActivityForAccount(
  account: Account
): Exclude<CashFlowActivity, "unclassified"> | undefined {
  const typeText = `${account.type} ${account.subtype ?? ""}`;

  switch (account.classification) {
    case "asset":
      return INVESTING_ASSET_PATTERN.test(typeText) ? "investing" : "operating";
    case "liability":
      return FINANCING_LIABILITY_PATTERN.test(typeText) ? "financing" : "operating";
    case "equity":
      return "financing";
    default:
      return undefined;
  }
}

/**
 * Builds the indirect-method cash flow statement (net income plus balance
 * sheet movements) from canonical postings. This matches the presentation of
 * provider statements of cash flows (for example QuickBooks): operating cash
 * starts from net income and adjusts for working-capital changes; investing
 * and financing sections carry long-lived asset, debt, and equity movements.
 * The statement reconciles its computed net cash change against the actual
 * movement in the designated cash accounts.
 */
export function buildIndirectCashFlowReport(input: CashFlowBuilderInput): BuiltReport {
  assertReportBuilderInputComplete(input);
  const accountMap = createAccountMap(input);
  const cashAccountIds = expandAccountIdsToDescendants(input.cashAccountIds, accountMap);
  const snapshot = snapshotId("cash_flow", input);
  const periodPostings = filterPeriodPostings(input);
  const beginningCash = filterBeforeDatePostings(input)
    .filter((posting) => cashAccountIds.has(posting.accountId))
    .reduce((sum, posting) => sum + signedDebitMinusCredit(posting), 0n);
  const actualCashMovement = periodPostings
    .filter((posting) => cashAccountIds.has(posting.accountId))
    .reduce((sum, posting) => sum + signedDebitMinusCredit(posting), 0n);
  const netIncome = earningsAccumulator(input, accountMap, {
    from: input.periodStart,
    through: input.periodEnd,
    key: "net_income",
    label: "Net Income"
  });
  const nonCashBalanceSheetPostings = periodPostings.filter((posting) => {
    if (cashAccountIds.has(posting.accountId)) {
      return false;
    }
    const account = accountMap.get(posting.accountId);
    return account !== undefined && BALANCE_SHEET_SECTIONS.includes(account.classification);
  });
  const balanceChanges = aggregateByAccount(nonCashBalanceSheetPostings, accountMap, signedDebitMinusCredit);
  const adjustmentsByActivity: Record<Exclude<CashFlowActivity, "unclassified">, LineAccumulator[]> = {
    operating: [],
    investing: [],
    financing: []
  };

  for (const balance of [...balanceChanges.values()].sort((left, right) =>
    compareStatementAccountBalances(left, right, BALANCE_SHEET_SECTIONS)
  )) {
    if (balance.amountMinor === 0n) {
      continue;
    }
    const activity =
      cashFlowActivityForAccount(balance.account.accountId, accountMap, input.activityByAccountId) ??
      defaultCashFlowActivityForAccount(balance.account) ??
      "operating";

    // Cash impact is the inverse of the account's debit-based movement:
    // an asset increase consumes cash; a liability or equity increase
    // (credit movement) provides cash.
    adjustmentsByActivity[activity].push({
      key: balance.account.accountId,
      label: accountLabel(balance.account),
      section: activity,
      amountMinor: -balance.amountMinor,
      postingIds: unique(balance.postingIds),
      accountIds: [balance.account.accountId],
      sourceRefs: uniqueSourceRefs(balance.sourceRefs)
    });
  }

  const lines: ReportSnapshotLine[] = [];
  const appendLine = (section: string, key: string, label: string, accumulator: LineAccumulator): void => {
    lines.push({
      tenantId: input.tenantId,
      reportSnapshotId: snapshot,
      reportLineId: lineId("cash_flow", lines.length + 1, key),
      section,
      label,
      amount: formatMoney(accumulator.amountMinor),
      sortOrder: (lines.length + 1) * 10,
      drilldownRef: drilldownRef(
        input,
        "cash_flow",
        key,
        accumulator.postingIds,
        accumulator.accountIds,
        accumulator.sourceRefs
      )
    });
  };

  appendLine("operating", "net_income", "Net Income", netIncome);
  for (const adjustment of adjustmentsByActivity.operating) {
    appendLine("operating", `operating:${adjustment.key}`, adjustment.label, adjustment);
  }
  for (const adjustment of adjustmentsByActivity.investing) {
    appendLine("investing", `investing:${adjustment.key}`, adjustment.label, adjustment);
  }
  for (const adjustment of adjustmentsByActivity.financing) {
    appendLine("financing", `financing:${adjustment.key}`, adjustment.label, adjustment);
  }

  const operatingCash = netIncome.amountMinor + sumLineAmounts(adjustmentsByActivity.operating);
  const investingCash = sumLineAmounts(adjustmentsByActivity.investing);
  const financingCash = sumLineAmounts(adjustmentsByActivity.financing);
  const netCashFlow = operatingCash + investingCash + financingCash;
  const endingCash = beginningCash + netCashFlow;
  const operatingAccumulators = [netIncome, ...adjustmentsByActivity.operating];
  const beginningCashPostingIds = filterBeforeDatePostings(input)
    .filter((posting) => cashAccountIds.has(posting.accountId))
    .map((posting) => posting.postingId);
  const cashPostingIds = periodPostings
    .filter((posting) => cashAccountIds.has(posting.accountId))
    .map((posting) => posting.postingId);
  const totals = [
    totalFromLines(input, "cash_flow", "net_income", "Net Income", [netIncome]),
    totalFromLines(
      input,
      "cash_flow",
      "net_operating_cash",
      "Net Cash from Operating Activities",
      operatingAccumulators
    ),
    totalFromLines(
      input,
      "cash_flow",
      "net_investing_cash",
      "Net Cash from Investing Activities",
      adjustmentsByActivity.investing
    ),
    totalFromLines(
      input,
      "cash_flow",
      "net_financing_cash",
      "Net Cash from Financing Activities",
      adjustmentsByActivity.financing
    ),
    cashTotal(
      input,
      "net_cash_flow",
      "Net Change in Cash",
      netCashFlow,
      mergeAccountIds(operatingAccumulators, [...adjustmentsByActivity.investing, ...adjustmentsByActivity.financing]),
      mergePostingIds(operatingAccumulators, [...adjustmentsByActivity.investing, ...adjustmentsByActivity.financing])
    ),
    cashTotal(input, "cash_beginning", "Cash at Beginning of Period", beginningCash, [...cashAccountIds], beginningCashPostingIds),
    cashTotal(input, "cash_ending", "Cash at End of Period", endingCash, [...cashAccountIds], cashPostingIds)
  ];
  const reconciliationDifference = actualCashMovement - netCashFlow;
  const unsupportedReasons = input.cashAccountIds.length === 0 ? ["cash_flow_requires_cash_account_ids"] : [];

  return buildReportResult(input, "cash_flow", lines, totals, {
    reconciliationStatus: reconciliationDifference === 0n ? "balanced" : "out_of_balance",
    reconciliationDifference: formatMoney(reconciliationDifference),
    cashFlow: {
      supportStatus: input.cashAccountIds.length === 0 ? "unsupported" : "supported",
      derivationMethod: "indirect_net_income_adjustments",
      cashAccountIds: input.cashAccountIds,
      unsupportedReasons,
      unclassifiedCashMovementPostingIds: []
    }
  });
}

export function assertReportBuilderInputComplete(input: ReportBuilderInput): void {
  const accountMap = createAccountMap(input);
  assertValidAccountHierarchy(input.accounts, { accountsToValidate: [...accountMap.values()] });

  for (const posting of input.postings.filter((entry) => postingMatchesReportScope(input, entry))) {
    assertLedgerPostingAmounts(posting);
    if (parseMoney(posting.netAmount) !== signedDebitMinusCredit(posting)) {
      throw new Error(`Report builder input posting ${posting.postingId} has inconsistent netAmount`);
    }
    if (accountMap.get(posting.accountId) === undefined) {
      throw new Error(`Report builder input posting ${posting.postingId} references missing account ${posting.accountId}`);
    }
    if (posting.sourcePayloadRef !== undefined) {
      assertSafeSourcePayloadRef(posting.sourcePayloadRef);
    }
  }
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
  readonly sourceRefs: SafeSourcePayloadRef[];
};

function accountHierarchyAmountsForBalances(
  balances: ReadonlyMap<AccountId, AccountBalance>,
  classifications: readonly AccountClassification[]
): AccountHierarchyRollupLineAmount[] {
  return sortedMaterialBalancesForClassifications(balances, classifications).map((balance) => ({
    accountId: balance.account.accountId,
    amount: formatMoney(balance.amountMinor),
    section: balance.account.classification,
    postingIds: unique(balance.postingIds),
    sourceRefs: uniqueSourceRefs(balance.sourceRefs)
  }));
}

function accumulatorsForAccountBalances(
  balances: ReadonlyMap<AccountId, AccountBalance>,
  classifications: readonly AccountClassification[]
): LineAccumulator[] {
  return sortedMaterialBalancesForClassifications(balances, classifications).map((balance) => ({
    key: balance.account.accountId,
    label: accountLabel(balance.account),
    section: balance.account.classification,
    amountMinor: balance.amountMinor,
    postingIds: unique(balance.postingIds),
    accountIds: [balance.account.accountId],
    sourceRefs: uniqueSourceRefs(balance.sourceRefs)
  }));
}

function sortedMaterialBalancesForClassifications(
  balances: ReadonlyMap<AccountId, AccountBalance>,
  classifications: readonly AccountClassification[]
): AccountBalance[] {
  return [...balances.values()]
    .filter((balance) => balance.amountMinor !== 0n && classifications.includes(balance.account.classification))
    .sort((left, right) => compareStatementAccountBalances(left, right, classifications));
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
        postingIds: [posting.postingId],
        sourceRefs: sourceRefsFromPostings([posting])
      });
    } else {
      existing.amountMinor += amountForPosting(posting, account);
      existing.postingIds.push(posting.postingId);
      existing.sourceRefs.push(...sourceRefsFromPostings([posting]));
    }
  }

  return balances;
}

type EarningsWindow = {
  readonly key: string;
  readonly label: string;
  readonly before?: IsoDate;
  readonly from?: IsoDate;
  readonly through?: IsoDate;
};

function earningsAccumulator(
  input: ReportBuilderInput,
  accountMap: ReadonlyMap<AccountId, Account>,
  window: EarningsWindow
): LineAccumulator & { readonly key: string; readonly label: string } {
  const relevant = input.postings
    .filter(
      (posting) =>
        postingMatchesReportScope(input, posting) &&
        (window.before === undefined || posting.postingDate < window.before) &&
        (window.from === undefined || posting.postingDate >= window.from) &&
        (window.through === undefined || posting.postingDate <= window.through)
    )
    .filter((posting) => {
      const account = accountMap.get(posting.accountId);
      return account !== undefined && PROFIT_AND_LOSS_SECTIONS.includes(account.classification);
    })
    .sort(comparePostings);
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
    key: window.key,
    label: window.label,
    amountMinor,
    postingIds: relevant.map((posting) => posting.postingId),
    accountIds: unique(relevant.map((posting) => posting.accountId)),
    sourceRefs: sourceRefsFromPostings(relevant)
  };
}

function createAccountMap(input: ReportBuilderInput): ReadonlyMap<AccountId, Account> {
  const accounts = input.accounts.filter((account) => accountMatchesReportScope(input, account));
  const accountMap = new Map<AccountId, Account>();

  for (const account of accounts) {
    if (!ACCOUNT_CLASSIFICATIONS.has(account.classification)) {
      throw new Error(`Report builder input account ${account.accountId} has unsupported classification ${account.classification}`);
    }
    if (accountMap.has(account.accountId)) {
      throw new Error(`Report builder input has duplicate account ${account.accountId}`);
    }
    accountMap.set(account.accountId, account);
  }

  return accountMap;
}

function filterPeriodPostings(input: ReportBuilderInput): LedgerPosting[] {
  return input.postings
    .filter(
      (posting) =>
        postingMatchesReportScope(input, posting) &&
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
        postingMatchesReportScope(input, posting) &&
        posting.postingDate <= asOfDate
    )
    .sort(comparePostings);
}

function filterBeforeDatePostings(input: ReportBuilderInput): LedgerPosting[] {
  return input.postings
    .filter(
      (posting) =>
        postingMatchesReportScope(input, posting) &&
        posting.postingDate < input.periodStart
    )
    .sort(comparePostings);
}

function accountMatchesReportScope(input: ReportBuilderInput, account: Account): boolean {
  return account.tenantId === input.tenantId && (input.sourceId === undefined || account.sourceId === input.sourceId);
}

function postingMatchesReportScope(input: ReportBuilderInput, posting: LedgerPosting): boolean {
  return (
    posting.tenantId === input.tenantId &&
    (input.sourceId === undefined || posting.sourceId === input.sourceId) &&
    posting.accountingBasis === input.accountingBasis &&
    posting.currencyCode === input.currencyCode
  );
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
  readonly section?: string;
  readonly amountMinor: bigint;
  readonly postingIds: readonly LedgerPostingId[];
  readonly accountIds: readonly AccountId[];
  readonly sourceRefs: readonly SafeSourcePayloadRef[];
};

function addTotal(target: Map<string, LineAccumulator>, key: string, label: string, inputs: readonly LineAccumulator[]): void {
  target.set(key, {
    key,
    label,
    amountMinor: inputs.reduce((sum, input) => sum + input.amountMinor, 0n),
    postingIds: unique(inputs.flatMap((input) => input.postingIds)),
    accountIds: unique(inputs.flatMap((input) => input.accountIds)),
    sourceRefs: uniqueSourceRefs(inputs.flatMap((input) => input.sourceRefs))
  });
}

function accumulatorsForSection(accumulators: readonly LineAccumulator[], section: string): LineAccumulator[] {
  return accumulators.filter((accumulator) => accumulator.section === section);
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
    accountIds: unique(lines.flatMap((line) => line.accountIds)),
    sourceRefs: uniqueSourceRefs(lines.flatMap((line) => line.sourceRefs))
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
    drilldownRef: drilldownRef(input, reportName, total.key, total.postingIds, total.accountIds, total.sourceRefs)
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
    postingIds,
    sourceRefs: sourceRefsForPostingIds(input, postingIds)
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

function mergeSourceRefs(left: readonly LineAccumulator[], right: readonly LineAccumulator[] = []): SafeSourcePayloadRef[] {
  return uniqueSourceRefs([...left, ...right].flatMap((line) => line.sourceRefs));
}

function drilldownRef(
  input: ReportBuilderInput,
  reportName: ReportName,
  key: string,
  postingIds: readonly LedgerPostingId[],
  accountIds: readonly AccountId[],
  sourceRefs: readonly SafeSourcePayloadRef[]
): DrilldownRef {
  const sourceId = sourceIdForDrilldown(input, postingIds);

  return createCompactDrilldownRef({
    token: `${reportName}:${key}`,
    postingIds: unique(postingIds),
    accountIds: unique(accountIds),
    query: {
      kind: "ledger_postings",
      tenantId: input.tenantId,
      ...(sourceId === undefined ? {} : { sourceId }),
      accountingBasis: input.accountingBasis,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      accountIds: unique(accountIds)
    },
    sourceRefs: uniqueSourceRefs(sourceRefs)
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
  readonly sourceRefs: SafeSourcePayloadRef[];
};

function emptyCashFlowAccumulator(activity: CashFlowActivity): CashFlowAccumulator {
  return {
    activity,
    amountMinor: 0n,
    postingIds: [],
    accountIds: new Set<AccountId>(),
    sourceRefs: []
  };
}

function sourceIdForDrilldown(input: ReportBuilderInput, postingIds: readonly LedgerPostingId[]): SourceId | undefined {
  if (input.sourceId !== undefined) {
    return input.sourceId;
  }

  const postingIdSet = new Set(postingIds);
  const sourceIds = unique(input.postings.filter((posting) => postingIdSet.has(posting.postingId)).map((posting) => posting.sourceId));
  return sourceIds.length === 1 ? sourceIds[0] : undefined;
}

function sourceRefsForPostingIds(input: ReportBuilderInput, postingIds: readonly LedgerPostingId[]): SafeSourcePayloadRef[] {
  const postingIdSet = new Set(postingIds);
  return sourceRefsFromPostings(input.postings.filter((posting) => postingIdSet.has(posting.postingId)));
}

function sourceRefsFromPostings(postings: readonly LedgerPosting[]): SafeSourcePayloadRef[] {
  return uniqueSourceRefs(
    postings
      .map((posting) => posting.sourcePayloadRef)
      .filter((sourceRef): sourceRef is SafeSourcePayloadRef => sourceRef !== undefined)
  );
}

function uniqueSourceRefs(values: readonly SafeSourcePayloadRef[]): SafeSourcePayloadRef[] {
  const refs = new Map<string, SafeSourcePayloadRef>();
  for (const value of values) {
    refs.set(
      [
        value.sourceObjectType,
        value.sourceObjectId,
        value.storageRef ?? "",
        value.checksum ?? "",
        value.sourceUpdatedAt ?? ""
      ].join(":"),
      value
    );
  }

  return [...refs.values()].sort((left, right) =>
    [left.sourceObjectType, left.sourceObjectId, left.storageRef ?? "", left.checksum ?? ""]
      .join(":")
      .localeCompare([right.sourceObjectType, right.sourceObjectId, right.storageRef ?? "", right.checksum ?? ""].join(":"))
  );
}

function classifyCashPosting(
  cashPosting: LedgerPosting,
  postingsByTransaction: ReadonlyMap<string, readonly LedgerPosting[]>,
  cashAccountIds: ReadonlySet<AccountId>,
  accountMap: ReadonlyMap<AccountId, Account>,
  activityByAccountId: Readonly<Record<AccountId, Exclude<CashFlowActivity, "unclassified">>>
): CashFlowActivity {
  const transactionPostings = postingsByTransaction.get(cashPosting.transactionId) ?? [];
  const activities = unique(
    transactionPostings
      .filter((posting) => posting.postingId !== cashPosting.postingId && !cashAccountIds.has(posting.accountId))
      .map((posting) => cashFlowActivityForAccount(posting.accountId, accountMap, activityByAccountId))
      .filter((activity): activity is Exclude<CashFlowActivity, "unclassified"> => activity !== undefined)
  );

  const onlyActivity = activities[0];
  return activities.length === 1 && onlyActivity !== undefined ? onlyActivity : "unclassified";
}

function expandAccountIdsToDescendants(
  accountIds: readonly AccountId[],
  accountMap: ReadonlyMap<AccountId, Account>
): ReadonlySet<AccountId> {
  const expanded = new Set<AccountId>(accountIds);
  const childrenByParentId = new Map<AccountId, Account[]>();

  for (const account of accountMap.values()) {
    if (account.parentAccountId === undefined) {
      continue;
    }
    const children = childrenByParentId.get(account.parentAccountId);
    if (children === undefined) {
      childrenByParentId.set(account.parentAccountId, [account]);
    } else {
      children.push(account);
    }
  }

  const visit = (accountId: AccountId): void => {
    for (const child of childrenByParentId.get(accountId) ?? []) {
      if (expanded.has(child.accountId)) {
        continue;
      }
      expanded.add(child.accountId);
      visit(child.accountId);
    }
  };

  for (const accountId of accountIds) {
    visit(accountId);
  }

  return expanded;
}

function cashFlowActivityForAccount(
  accountId: AccountId,
  accountMap: ReadonlyMap<AccountId, Account>,
  activityByAccountId: Readonly<Record<AccountId, Exclude<CashFlowActivity, "unclassified">>>
): Exclude<CashFlowActivity, "unclassified"> | undefined {
  const directActivity = activityByAccountId[accountId];
  if (directActivity !== undefined) {
    return directActivity;
  }

  let account = accountMap.get(accountId);
  while (account?.parentAccountId !== undefined) {
    const activity = activityByAccountId[account.parentAccountId];
    if (activity !== undefined) {
      return activity;
    }
    account = accountMap.get(account.parentAccountId);
  }

  return undefined;
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
