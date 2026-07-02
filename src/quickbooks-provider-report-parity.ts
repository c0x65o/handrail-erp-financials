import { assertNoCredentialKeys } from "./canonical-model.js";
import type {
  Account,
  AccountClassification,
  AccountId,
  AccountingBasis,
  DecimalString,
  IsoCurrencyCode,
  IsoDate,
  LedgerPosting,
  ReconciliationStatus,
  SourceId,
  TenantId
} from "./canonical-model.js";
import type { BuiltReport } from "./report-builders.js";
import type {
  NormalizedQuickBooksCanonicalReportTotal,
  NormalizedQuickBooksProviderReportAccountTotal,
  NormalizedQuickBooksProviderReportResponseEnvelope
} from "./normalized-accounting-contracts.js";

/**
 * Account-level reconciliation between a QuickBooks provider trial balance
 * report and canonical ledger postings.
 *
 * The provider side comes from the QuickBooks Reports API (TrialBalance),
 * exposed by handrail-integration-quickbooks as signed per-account net
 * amounts (debits positive, credits negative). The canonical side is derived
 * from `ledger_postings` with QuickBooks trial-balance semantics:
 * balance-sheet accounts accumulate through `periodEnd`, income-statement
 * accounts accumulate activity within [`periodStart`, `periodEnd`].
 */

export const MAX_PROVIDER_REPORT_ACCOUNT_TOTALS = 1000;

const BALANCE_SHEET_CLASSIFICATIONS: ReadonlySet<AccountClassification> = new Set([
  "asset",
  "liability",
  "equity"
]);

export type QuickBooksAccountParityStatus =
  | "matched"
  | "mismatched"
  | "missing_in_provider"
  | "missing_in_canonical";

export type QuickBooksTrialBalanceAccountParityLine = {
  readonly accountSourceId: string;
  readonly accountId?: AccountId;
  readonly label: string;
  readonly classification?: AccountClassification;
  readonly canonicalAmount: DecimalString;
  readonly providerAmount: DecimalString;
  readonly difference: DecimalString;
  readonly status: QuickBooksAccountParityStatus;
};

export type QuickBooksTrialBalanceAccountParityReport = {
  readonly reportName: "trial_balance";
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly toleranceAmount: DecimalString;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly reconciliationDifference: DecimalString;
  readonly matchedCount: number;
  readonly mismatchedCount: number;
  readonly missingInProviderCount: number;
  readonly missingInCanonicalCount: number;
  readonly lines: readonly QuickBooksTrialBalanceAccountParityLine[];
};

export type QuickBooksTrialBalanceAccountParityInput = {
  readonly providerReport: NormalizedQuickBooksProviderReportResponseEnvelope;
  readonly tenantId: TenantId;
  readonly sourceId?: SourceId;
  readonly accounts: readonly Account[];
  readonly postings: readonly LedgerPosting[];
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly toleranceAmount?: DecimalString;
};

export function sanitizeQuickBooksProviderReportAccountTotals(
  accountTotals: readonly NormalizedQuickBooksProviderReportAccountTotal[]
): readonly NormalizedQuickBooksProviderReportAccountTotal[] {
  if (accountTotals.length > MAX_PROVIDER_REPORT_ACCOUNT_TOTALS) {
    throw new Error(
      `QuickBooks provider report accountTotals must be bounded to ${String(MAX_PROVIDER_REPORT_ACCOUNT_TOTALS)} entries or fewer`
    );
  }

  const seen = new Set<string>();
  return accountTotals.map((accountTotal): NormalizedQuickBooksProviderReportAccountTotal => {
    if (accountTotal.accountSourceId.length === 0) {
      throw new Error("QuickBooks provider report accountTotal accountSourceId is required");
    }
    if (seen.has(accountTotal.accountSourceId)) {
      throw new Error(
        `QuickBooks provider report accountTotals has duplicate accountSourceId ${accountTotal.accountSourceId}`
      );
    }
    seen.add(accountTotal.accountSourceId);

    return {
      accountSourceId: accountTotal.accountSourceId,
      ...(accountTotal.label === undefined ? {} : { label: accountTotal.label }),
      amount: formatMoney(parseMoney(accountTotal.amount)),
      ...(accountTotal.currencyCode === undefined ? {} : { currencyCode: accountTotal.currencyCode })
    };
  });
}

/**
 * Converts a built canonical report's totals into the canonical totals shape
 * consumed by the provider-report reconciliation evidence builders. The built
 * report totalKeys (total_income, total_cost_of_goods_sold, gross_profit,
 * net_income, total_assets, ...) are the shared reconciliation vocabulary that
 * the QuickBooks provider report parser also emits.
 */
export function buildQuickBooksCanonicalReportTotalsFromBuiltReport(
  report: BuiltReport,
  currencyCode?: IsoCurrencyCode
): readonly NormalizedQuickBooksCanonicalReportTotal[] {
  return report.totals.map((total): NormalizedQuickBooksCanonicalReportTotal => ({
    totalKey: total.totalKey,
    amount: total.amount,
    currencyCode: currencyCode ?? report.snapshot.currencyCode
  }));
}

export function buildQuickBooksTrialBalanceAccountParity(
  input: QuickBooksTrialBalanceAccountParityInput
): QuickBooksTrialBalanceAccountParityReport {
  assertNoCredentialKeys(input);

  if (input.providerReport.reportName !== "trial_balance") {
    throw new Error(
      `QuickBooks trial balance account parity requires a trial_balance provider report, received ${input.providerReport.reportName}`
    );
  }
  if (input.providerReport.supportStatus !== "supported") {
    throw new Error("QuickBooks trial balance account parity requires a supported provider report");
  }
  if (input.providerReport.accountTotals === undefined) {
    throw new Error(
      "QuickBooks trial balance account parity requires provider accountTotals; upgrade handrail-integration-quickbooks to a version that emits account-level trial balance rows"
    );
  }

  const toleranceAmount = input.toleranceAmount ?? "0.00";
  const toleranceMinor = parseMoney(toleranceAmount);
  if (toleranceMinor < 0n) {
    throw new Error("QuickBooks trial balance account parity toleranceAmount must be nonnegative");
  }

  const providerTotals = sanitizeQuickBooksProviderReportAccountTotals(input.providerReport.accountTotals);
  const canonicalBalances = canonicalTrialBalanceBySourceAccountId(input);
  const accountsBySourceId = new Map(
    scopedAccounts(input).map((account) => [account.sourceAccountId, account])
  );

  const lines: QuickBooksTrialBalanceAccountParityLine[] = [];
  const seenSourceIds = new Set<string>();

  for (const providerTotal of providerTotals) {
    if (
      providerTotal.currencyCode !== undefined &&
      providerTotal.currencyCode !== input.currencyCode
    ) {
      throw new Error(
        `QuickBooks trial balance account parity currency mismatch for account ${providerTotal.accountSourceId}: provider ${providerTotal.currencyCode}, canonical ${input.currencyCode}`
      );
    }

    seenSourceIds.add(providerTotal.accountSourceId);
    const account = accountsBySourceId.get(providerTotal.accountSourceId);
    const canonicalMinor = canonicalBalances.get(providerTotal.accountSourceId) ?? 0n;
    const providerMinor = parseMoney(providerTotal.amount);
    const differenceMinor = providerMinor - canonicalMinor;
    const status: QuickBooksAccountParityStatus =
      account === undefined && canonicalMinor === 0n
        ? "missing_in_canonical"
        : absolute(differenceMinor) <= toleranceMinor
          ? "matched"
          : "mismatched";

    lines.push({
      accountSourceId: providerTotal.accountSourceId,
      ...(account === undefined ? {} : { accountId: account.accountId }),
      label: providerTotal.label ?? account?.name ?? providerTotal.accountSourceId,
      ...(account === undefined ? {} : { classification: account.classification }),
      canonicalAmount: formatMoney(canonicalMinor),
      providerAmount: formatMoney(providerMinor),
      difference: formatMoney(differenceMinor),
      status
    });
  }

  for (const [sourceAccountId, canonicalMinor] of canonicalBalances) {
    if (seenSourceIds.has(sourceAccountId) || canonicalMinor === 0n) {
      continue;
    }

    const account = accountsBySourceId.get(sourceAccountId);
    const differenceMinor = -canonicalMinor;
    lines.push({
      accountSourceId: sourceAccountId,
      ...(account === undefined ? {} : { accountId: account.accountId }),
      label: account?.name ?? sourceAccountId,
      ...(account === undefined ? {} : { classification: account.classification }),
      canonicalAmount: formatMoney(canonicalMinor),
      providerAmount: "0.00",
      difference: formatMoney(differenceMinor),
      status: absolute(differenceMinor) <= toleranceMinor ? "matched" : "missing_in_provider"
    });
  }

  lines.sort(compareParityLines);

  const matchedCount = lines.filter((line) => line.status === "matched").length;
  const mismatchedCount = lines.filter((line) => line.status === "mismatched").length;
  const missingInProviderCount = lines.filter((line) => line.status === "missing_in_provider").length;
  const missingInCanonicalCount = lines.filter((line) => line.status === "missing_in_canonical").length;
  const reconciliationDifference = lines.reduce((largest, line) => {
    const difference = absolute(parseMoney(line.difference));
    return difference > largest ? difference : largest;
  }, 0n);

  const report: QuickBooksTrialBalanceAccountParityReport = {
    reportName: "trial_balance",
    accountingBasis: input.accountingBasis,
    currencyCode: input.currencyCode,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    toleranceAmount,
    reconciliationStatus: lines.every((line) => line.status === "matched") ? "balanced" : "out_of_balance",
    reconciliationDifference: formatMoney(reconciliationDifference),
    matchedCount,
    mismatchedCount,
    missingInProviderCount,
    missingInCanonicalCount,
    lines
  };
  assertNoCredentialKeys(report);
  return report;
}

function canonicalTrialBalanceBySourceAccountId(
  input: QuickBooksTrialBalanceAccountParityInput
): Map<string, bigint> {
  const accounts = scopedAccounts(input);
  const accountsById = new Map(accounts.map((account) => [account.accountId, account]));
  const balances = new Map<string, bigint>();

  for (const posting of input.postings) {
    if (
      posting.tenantId !== input.tenantId ||
      (input.sourceId !== undefined && posting.sourceId !== input.sourceId) ||
      posting.accountingBasis !== input.accountingBasis ||
      posting.currencyCode !== input.currencyCode
    ) {
      continue;
    }

    const account = accountsById.get(posting.accountId);
    if (account === undefined) {
      continue;
    }

    const includePosting = BALANCE_SHEET_CLASSIFICATIONS.has(account.classification)
      ? posting.postingDate <= input.periodEnd
      : posting.postingDate >= input.periodStart && posting.postingDate <= input.periodEnd;
    if (!includePosting) {
      continue;
    }

    const net = parseMoney(posting.debitAmount) - parseMoney(posting.creditAmount);
    balances.set(account.sourceAccountId, (balances.get(account.sourceAccountId) ?? 0n) + net);
  }

  return balances;
}

function scopedAccounts(input: QuickBooksTrialBalanceAccountParityInput): readonly Account[] {
  return input.accounts.filter(
    (account) =>
      account.tenantId === input.tenantId && (input.sourceId === undefined || account.sourceId === input.sourceId)
  );
}

function compareParityLines(
  left: QuickBooksTrialBalanceAccountParityLine,
  right: QuickBooksTrialBalanceAccountParityLine
): number {
  const leftDifference = absolute(parseMoney(left.difference));
  const rightDifference = absolute(parseMoney(right.difference));
  if (leftDifference !== rightDifference) {
    return rightDifference > leftDifference ? 1 : -1;
  }
  return left.label.localeCompare(right.label) || left.accountSourceId.localeCompare(right.accountSourceId);
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
  const absoluteValue = value < 0n ? -value : value;
  const whole = absoluteValue / 100n;
  const fraction = absoluteValue % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
