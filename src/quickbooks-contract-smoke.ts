import { createHash } from "node:crypto";

import { assertNoCredentialKeys } from "./canonical-model.js";
import {
  buildBalanceSheetReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "./report-builders.js";
import {
  buildRollupBuckets,
  createSnapshotRefreshContract,
  reconcileReportFreshness
} from "./rollup-jobs.js";
import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES
} from "./fixtures.js";
import {
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts
} from "./source-adapters.js";

import type {
  AccountingBasis,
  DecimalString,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  LedgerPosting
} from "./canonical-model.js";
import type { ReportFreshnessRow, RollupBucketGrain } from "./postgres-storage.js";
import type { BuiltReport, ReportBuilderInput, ReportName } from "./report-builders.js";
import type {
  HandrailQuickBooksAccountResource,
  HandrailQuickBooksCompanyInfoResource,
  HandrailQuickBooksLedgerTransactionResource,
  HandrailQuickBooksSdkResourcesAdapterInput,
  CanonicalAccountingFactSet,
  QuickBooksAdapterContext,
  QuickBooksSdkAccount,
  QuickBooksSdkCompanyInfo
} from "./source-adapters.js";
import type {
  NormalizedQuickBooksLedgerEntryResource,
  NormalizedQuickBooksProviderReportResponseEnvelope,
  NormalizedQuickBooksResourceSet,
  NormalizedQuickBooksServiceHealthProbeResponseEnvelope
} from "./normalized-accounting-contracts.js";

export type QuickBooksContractSmokeHarnessOptions = {
  readonly resources?: NormalizedQuickBooksResourceSet;
  readonly providerReports?: readonly NormalizedQuickBooksProviderReportResponseEnvelope[];
  readonly accountingBasis?: AccountingBasis;
  readonly currencyCode?: IsoCurrencyCode;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly asOfDate?: IsoDate;
  readonly generatedAt?: IsoDateTime;
};

export type QuickBooksContractSmokeReportTotals = Readonly<Record<string, DecimalString>>;

export type QuickBooksContractSmokeSnapshot = {
  readonly sourceIdentity: {
    readonly tenantId: string;
    readonly sourceId: string;
    readonly sourceSystem: "quickbooks";
    readonly providerEnvironment: string;
    readonly realmId: string;
    readonly sourceCompanyRef: string;
  };
  readonly importBatchId: string;
  readonly checkpointId: string;
  readonly sourceFreshThrough?: IsoDateTime;
  readonly importedThrough?: IsoDateTime;
  readonly latestSourceUpdatedAt?: IsoDateTime;
  readonly normalizedResourceCounts: Readonly<Record<string, number>>;
  readonly adapterContext: {
    readonly tenantId: string;
    readonly sourceId: string;
    readonly providerEnvironment: string;
    readonly realmId: string;
    readonly accountingBasis: AccountingBasis;
    readonly defaultCurrencyCode: IsoCurrencyCode;
  };
  readonly canonicalCounts: {
    readonly accounts: number;
    readonly parties: number;
    readonly items: number;
    readonly dimensions: number;
    readonly transactions: number;
    readonly transactionLines: number;
    readonly postings: number;
  };
  readonly canonicalPostingTotals: {
    readonly debitTotal: DecimalString;
    readonly creditTotal: DecimalString;
    readonly netTotal: DecimalString;
  };
  readonly reports: Readonly<Record<"profitAndLoss" | "balanceSheet" | "trialBalance", QuickBooksContractSmokeReportTotals>>;
  readonly erpContracts: {
    readonly freshness: {
      readonly freshnessId: string;
      readonly status: ReportFreshnessRow["status"];
      readonly freshThrough?: IsoDateTime;
      readonly importBatchId?: string;
      readonly checkpointId?: string;
      readonly updatedAt: IsoDateTime;
    };
    readonly snapshotRefresh: {
      readonly snapshotId: string;
      readonly freshnessId: string;
      readonly status: ReportFreshnessRow["status"];
      readonly freshThrough?: IsoDateTime;
      readonly importBatchId?: string;
      readonly checkpointId?: string;
    };
    readonly rollup: {
      readonly bucketGrains: readonly RollupBucketGrain[];
      readonly bucketCount: number;
      readonly postingCount: number;
      readonly accountCount: number;
      readonly dimensionHashCount: number;
      readonly sourcePostingMaxUpdatedAt?: IsoDateTime;
      readonly bucketSummaries: readonly {
        readonly bucketGrain: RollupBucketGrain;
        readonly bucketCount: number;
        readonly windowCount: number;
        readonly bucketStartMin?: IsoDate;
        readonly bucketEndMax?: IsoDate;
      }[];
    };
    readonly health: {
      readonly status: NormalizedQuickBooksServiceHealthProbeResponseEnvelope["status"];
      readonly serviceAvailability: NormalizedQuickBooksServiceHealthProbeResponseEnvelope["serviceAvailability"];
      readonly providerMode: NormalizedQuickBooksServiceHealthProbeResponseEnvelope["providerMode"];
      readonly serviceEnvironment?: NormalizedQuickBooksServiceHealthProbeResponseEnvelope["serviceEnvironment"];
      readonly capabilityStatuses: Readonly<Record<keyof NormalizedQuickBooksServiceHealthProbeResponseEnvelope["capabilities"], string>>;
      readonly checkpoint: {
        readonly checkpointId?: string;
        readonly status: string;
        readonly sourceFreshThrough?: IsoDateTime;
        readonly importedThrough?: IsoDateTime;
        readonly latestSourceUpdatedAt?: IsoDateTime;
      };
      readonly issueCount: number;
    };
  };
  readonly providerReports: readonly {
    readonly reportName: ReportName;
    readonly supportStatus: string;
    readonly unsupportedReason?: string;
    readonly providerEnvironment?: string;
    readonly importBatchId?: string;
    readonly checkpointId?: string;
    readonly sourceFreshThrough?: IsoDateTime;
    readonly importedThrough?: IsoDateTime;
    readonly latestSourceUpdatedAt?: IsoDateTime;
    readonly totalCount: number;
    readonly totals: QuickBooksContractSmokeReportTotals;
  }[];
  readonly unsupportedProviderStates: readonly {
    readonly reportName: ReportName;
    readonly supportStatus: string;
    readonly unsupportedReason: string;
    readonly documentedBehavior: string;
  }[];
};

export type QuickBooksContractSmokeHarnessResult = {
  readonly normalizedResources: NormalizedQuickBooksResourceSet;
  readonly adapterInput: HandrailQuickBooksSdkResourcesAdapterInput;
  readonly facts: CanonicalAccountingFactSet;
  readonly reportInput: ReportBuilderInput;
  readonly reports: {
    readonly profitAndLoss: BuiltReport;
    readonly balanceSheet: BuiltReport;
    readonly trialBalance: BuiltReport;
  };
  readonly snapshot: QuickBooksContractSmokeSnapshot;
  readonly snapshotHash: string;
};

const DEFAULT_CONTRACT_SMOKE_PERIOD = {
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  asOfDate: "2026-01-31",
  generatedAt: "2026-02-01T10:15:00.000Z"
} as const;

export function createQuickBooksContractSmokeHarness(
  options: QuickBooksContractSmokeHarnessOptions = {}
): QuickBooksContractSmokeHarnessResult {
  const normalizedResources = options.resources ?? ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.fullSync.response.resources;
  const providerReports = options.providerReports ?? defaultProviderReports();
  assertNoCredentialKeys(normalizedResources);
  assertNoCredentialKeys(providerReports);

  const adapterInput = adaptNormalizedQuickBooksResourceSetToAdapterInput(normalizedResources, options);
  const facts = mapHandrailQuickBooksSdkResourcesToCanonicalFacts(adapterInput);
  const reportInput: ReportBuilderInput = {
    tenantId: facts.company.tenantId,
    accounts: facts.accounts,
    postings: facts.postings,
    accountingBasis: options.accountingBasis ?? adapterInput.context.accountingBasis,
    currencyCode: options.currencyCode ?? adapterInput.context.defaultCurrencyCode,
    periodStart: options.periodStart ?? DEFAULT_CONTRACT_SMOKE_PERIOD.periodStart,
    periodEnd: options.periodEnd ?? DEFAULT_CONTRACT_SMOKE_PERIOD.periodEnd,
    asOfDate: options.asOfDate ?? DEFAULT_CONTRACT_SMOKE_PERIOD.asOfDate,
    generatedAt: options.generatedAt ?? DEFAULT_CONTRACT_SMOKE_PERIOD.generatedAt
  };
  const reports = {
    profitAndLoss: buildProfitAndLossReport(reportInput),
    balanceSheet: buildBalanceSheetReport(reportInput),
    trialBalance: buildTrialBalanceReport(reportInput)
  };
  const snapshot = buildQuickBooksContractSmokeSnapshot(normalizedResources, adapterInput, facts, reportInput, reports, providerReports);
  const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot, null, 2)).digest("hex");

  return {
    normalizedResources,
    adapterInput,
    facts,
    reportInput,
    reports,
    snapshot,
    snapshotHash
  };
}

export function adaptNormalizedQuickBooksResourceSetToAdapterInput(
  resources: NormalizedQuickBooksResourceSet,
  options: Pick<QuickBooksContractSmokeHarnessOptions, "accountingBasis" | "currencyCode"> = {}
): HandrailQuickBooksSdkResourcesAdapterInput {
  const context: QuickBooksAdapterContext = {
    tenantId: resources.identity.tenantId,
    companyId: `company_${resources.identity.realmId}`,
    sourceId: resources.identity.sourceId,
    realmId: resources.identity.realmId,
    providerEnvironment: resources.identity.providerEnvironment,
    importBatchId: resources.importBatch?.importBatchId ?? resources.companyInfo.importBatchId ?? "batch_quickbooks_contract_smoke",
    checkpointId: resources.checkpoint?.checkpointId ?? resources.companyInfo.checkpointId ?? "checkpoint_quickbooks_contract_smoke",
    accountingBasis: options.accountingBasis ?? "accrual",
    defaultCurrencyCode: options.currencyCode ?? resources.companyInfo.resource.baseCurrencyCode ?? "USD",
    importedAt: resources.importBatch?.completedAt ?? resources.importBatch?.startedAt ?? "2026-02-01T10:15:00.000Z",
    ...(resources.checkpoint?.freshThrough === undefined ? {} : { freshThrough: resources.checkpoint.freshThrough }),
    ...(resources.checkpoint?.latestSourceUpdatedAt === undefined
      ? {}
      : { latestSourceUpdatedAt: resources.checkpoint.latestSourceUpdatedAt }),
    runtimeConfig: {
      serviceEnvironment: "staging",
      providerMode: resources.identity.providerEnvironment,
      tenantId: resources.identity.tenantId
    }
  };

  return {
    context,
    resources: {
      identity: resources.identity,
      ...(resources.importBatch === undefined ? {} : { importBatch: resources.importBatch }),
      ...(resources.checkpoint === undefined ? {} : { checkpoint: resources.checkpoint }),
      companyInfo: normalizedCompanyInfoToSdkResource(resources.companyInfo),
      accounts: resources.accounts.map(normalizedAccountToSdkResource),
      journalEntries: [],
      ledgerTransactions: normalizedLedgerTransactionResources(resources),
      ledgerPostings: resources.ledgerPostings ?? [],
      parties: resources.parties ?? [],
      customers: resources.customers ?? [],
      vendors: resources.vendors ?? [],
      items: resources.items ?? [],
      classes: resources.classes ?? [],
      departments: resources.departments ?? [],
      dimensions: resources.dimensions ?? [],
      providerReports: resources.providerReports ?? [],
      reconciliationEvidence: resources.reconciliationEvidence ?? []
    }
  };
}

function normalizedCompanyInfoToSdkResource(
  resource: NormalizedQuickBooksResourceSet["companyInfo"]
): HandrailQuickBooksCompanyInfoResource {
  const companyInfo: QuickBooksSdkCompanyInfo = {
    ...(resource.resource.companyName === undefined ? {} : { CompanyName: resource.resource.companyName }),
    ...(resource.resource.legalName === undefined ? {} : { LegalName: resource.resource.legalName }),
    ...(resource.resource.fiscalYearStartMonth === undefined ? {} : { FiscalYearStartMonth: resource.resource.fiscalYearStartMonth })
  };

  return {
    ...resource,
    resource: companyInfo
  };
}

function normalizedAccountToSdkResource(resource: NormalizedQuickBooksResourceSet["accounts"][number]): HandrailQuickBooksAccountResource {
  const account: QuickBooksSdkAccount = {
    Id: resource.resource.sourceAccountId,
    Name: resource.resource.name,
    AccountType: resource.resource.accountType,
    ...(resource.resource.accountNumber === undefined ? {} : { AcctNum: resource.resource.accountNumber }),
    ...(resource.resource.accountSubType === undefined ? {} : { AccountSubType: resource.resource.accountSubType }),
    ...(resource.resource.active === undefined ? {} : { Active: resource.resource.active }),
    ...(resource.resource.currencyCode === undefined ? {} : { CurrencyRef: { value: resource.resource.currencyCode } })
  };

  return {
    ...resource,
    resource: account
  };
}

function normalizedLedgerTransactionResources(resources: NormalizedQuickBooksResourceSet): readonly HandrailQuickBooksLedgerTransactionResource[] {
  return [
    ...(resources.ledgerTransactions ?? []),
    ...(resources.journalEntries ?? []).map(normalizedJournalEntryToLedgerTransactionResource)
  ];
}

function normalizedJournalEntryToLedgerTransactionResource(
  resource: NormalizedQuickBooksLedgerEntryResource
): HandrailQuickBooksLedgerTransactionResource {
  return {
    ...resource,
    resourceType: "LedgerTransaction",
    resource: resource.resource
  };
}

function buildQuickBooksContractSmokeSnapshot(
  resources: NormalizedQuickBooksResourceSet,
  adapterInput: HandrailQuickBooksSdkResourcesAdapterInput,
  facts: CanonicalAccountingFactSet,
  reportInput: ReportBuilderInput,
  reports: QuickBooksContractSmokeHarnessResult["reports"],
  providerReports: readonly NormalizedQuickBooksProviderReportResponseEnvelope[]
): QuickBooksContractSmokeSnapshot {
  const generatedAt = reportInput.generatedAt ?? adapterInput.context.importedAt;
  const freshnessRow = reconcileReportFreshness({
    tenantId: facts.company.tenantId,
    companyId: facts.company.companyId,
    sourceId: facts.source.sourceId,
    reportName: "profit_and_loss",
    accountingBasis: reportInput.accountingBasis,
    periodStart: reportInput.periodStart,
    periodEnd: reportInput.periodEnd,
    currencyCode: reportInput.currencyCode,
    ...(resources.checkpoint?.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: resources.checkpoint.sourceFreshThrough }),
    ...(resources.checkpoint?.importedThrough === undefined ? {} : { importedThrough: resources.checkpoint.importedThrough }),
    importBatchId: adapterInput.context.importBatchId,
    checkpointId: adapterInput.context.checkpointId,
    updatedAt: generatedAt
  });
  const snapshotRefresh = createSnapshotRefreshContract({
    tenantId: facts.company.tenantId,
    companyId: facts.company.companyId,
    sourceId: facts.source.sourceId,
    reportName: "profit_and_loss",
    accountingBasis: reportInput.accountingBasis,
    periodStart: reportInput.periodStart,
    periodEnd: reportInput.periodEnd,
    asOfDate: reportInput.asOfDate ?? reportInput.periodEnd,
    currencyCode: reportInput.currencyCode,
    generatedAt,
    ...(resources.checkpoint?.sourceFreshThrough === undefined ? {} : { freshThrough: resources.checkpoint.sourceFreshThrough }),
    importBatchId: adapterInput.context.importBatchId,
    checkpointId: adapterInput.context.checkpointId
  });
  const rollupBucketGrains = ["month"] as const;
  const rollupBuckets = buildRollupBuckets({
    companyId: facts.company.companyId,
    postings: facts.postings,
    bucketGrains: rollupBucketGrains,
    fiscalYearStartMonth: facts.company.fiscalYearStartMonth,
    generatedAt,
    importBatchId: adapterInput.context.importBatchId
  });
  const serviceHealth = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES.serviceHealth.ready.response;

  return {
    sourceIdentity: {
      tenantId: resources.identity.tenantId,
      sourceId: resources.identity.sourceId,
      sourceSystem: resources.identity.sourceSystem,
      providerEnvironment: resources.identity.providerEnvironment,
      realmId: resources.identity.realmId,
      sourceCompanyRef: resources.identity.sourceCompanyRef
    },
    importBatchId: adapterInput.context.importBatchId,
    checkpointId: adapterInput.context.checkpointId,
    ...(resources.checkpoint?.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: resources.checkpoint.sourceFreshThrough }),
    ...(resources.checkpoint?.importedThrough === undefined ? {} : { importedThrough: resources.checkpoint.importedThrough }),
    ...(resources.checkpoint?.latestSourceUpdatedAt === undefined
      ? {}
      : { latestSourceUpdatedAt: resources.checkpoint.latestSourceUpdatedAt }),
    normalizedResourceCounts: normalizedResourceCounts(resources),
    adapterContext: {
      tenantId: adapterInput.context.tenantId,
      sourceId: adapterInput.context.sourceId,
      providerEnvironment: adapterInput.context.providerEnvironment,
      realmId: adapterInput.context.realmId,
      accountingBasis: adapterInput.context.accountingBasis,
      defaultCurrencyCode: adapterInput.context.defaultCurrencyCode
    },
    canonicalCounts: {
      accounts: facts.accounts.length,
      parties: facts.parties.length,
      items: facts.items.length,
      dimensions: facts.dimensions.length,
      transactions: facts.transactions.length,
      transactionLines: facts.transactionLines.length,
      postings: facts.postings.length
    },
    canonicalPostingTotals: ledgerPostingTotals(facts.postings),
    reports: {
      profitAndLoss: reportTotals(reports.profitAndLoss),
      balanceSheet: reportTotals(reports.balanceSheet),
      trialBalance: reportTotals(reports.trialBalance)
    },
    erpContracts: {
      freshness: {
        freshnessId: freshnessRow.freshnessId,
        status: freshnessRow.status,
        ...(freshnessRow.freshThrough === undefined ? {} : { freshThrough: freshnessRow.freshThrough }),
        ...(freshnessRow.importBatchId === undefined ? {} : { importBatchId: freshnessRow.importBatchId }),
        ...(freshnessRow.checkpointId === undefined ? {} : { checkpointId: freshnessRow.checkpointId }),
        updatedAt: freshnessRow.updatedAt
      },
      snapshotRefresh: {
        snapshotId: snapshotRefresh.snapshotId,
        freshnessId: snapshotRefresh.freshnessRow.freshnessId,
        status: snapshotRefresh.freshnessRow.status,
        ...(snapshotRefresh.freshnessRow.freshThrough === undefined ? {} : { freshThrough: snapshotRefresh.freshnessRow.freshThrough }),
        ...(snapshotRefresh.freshnessRow.importBatchId === undefined ? {} : { importBatchId: snapshotRefresh.freshnessRow.importBatchId }),
        ...(snapshotRefresh.freshnessRow.checkpointId === undefined ? {} : { checkpointId: snapshotRefresh.freshnessRow.checkpointId })
      },
      rollup: rollupContractSummary(rollupBucketGrains, rollupBuckets),
      health: serviceHealthContractSummary(serviceHealth)
    },
    providerReports: providerReports.map((report) => ({
      reportName: report.reportName,
      supportStatus: report.supportStatus,
      ...(report.unsupportedReason === undefined ? {} : { unsupportedReason: report.unsupportedReason }),
      providerEnvironment: report.providerEnvironment,
      ...(report.importBatchId === undefined ? {} : { importBatchId: report.importBatchId }),
      ...(report.checkpointId === undefined ? {} : { checkpointId: report.checkpointId }),
      ...(report.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: report.sourceFreshThrough }),
      ...(report.importedThrough === undefined ? {} : { importedThrough: report.importedThrough }),
      ...(report.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: report.latestSourceUpdatedAt }),
      totalCount: report.totals.length,
      totals: totalsByKey(report.totals.map((total) => [total.totalKey, total.amount]))
    })),
    unsupportedProviderStates: providerReports
      .filter((report) => report.supportStatus !== "supported" && report.unsupportedReason !== undefined)
      .map((report) => ({
        reportName: report.reportName,
        supportStatus: report.supportStatus,
        unsupportedReason: report.unsupportedReason ?? "unsupported_provider_report",
        documentedBehavior:
          "ERP Financials can build cash_flow from canonical facts, but QuickBooks provider cash-flow parity is intentionally unsupported in deterministic contract fixtures."
      }))
  };
}

function rollupContractSummary(
  bucketGrains: readonly RollupBucketGrain[],
  buckets: ReturnType<typeof buildRollupBuckets>
): QuickBooksContractSmokeSnapshot["erpContracts"]["rollup"] {
  const sourcePostingMaxUpdatedAt = maxIsoDateTime(buckets.map((bucket) => bucket.sourcePostingMaxUpdatedAt));

  return {
    bucketGrains,
    bucketCount: buckets.length,
    postingCount: buckets.reduce((sum, bucket) => sum + bucket.postingCount, 0),
    accountCount: uniqueSortedStrings(buckets.map((bucket) => bucket.accountId)).length,
    dimensionHashCount: uniqueSortedStrings(buckets.map((bucket) => bucket.dimensionHash)).length,
    ...(sourcePostingMaxUpdatedAt === undefined ? {} : { sourcePostingMaxUpdatedAt }),
    bucketSummaries: bucketGrains.map((bucketGrain) => rollupBucketGrainSummary(bucketGrain, buckets))
  };
}

function rollupBucketGrainSummary(
  bucketGrain: RollupBucketGrain,
  buckets: ReturnType<typeof buildRollupBuckets>
): QuickBooksContractSmokeSnapshot["erpContracts"]["rollup"]["bucketSummaries"][number] {
  const bucketsForGrain = buckets.filter((bucket) => bucket.bucketGrain === bucketGrain);
  const bucketStartMin = minIsoDate(bucketsForGrain.map((bucket) => bucket.bucketStart));
  const bucketEndMax = maxIsoDate(bucketsForGrain.map((bucket) => bucket.bucketEnd));
  const base = {
    bucketGrain,
    bucketCount: bucketsForGrain.length,
    windowCount: uniqueSortedStrings(bucketsForGrain.map((bucket) => `${bucket.bucketStart}:${bucket.bucketEnd}`)).length
  };

  if (bucketStartMin === undefined || bucketEndMax === undefined) {
    return base;
  }

  return {
    ...base,
    bucketStartMin,
    bucketEndMax
  };
}

function serviceHealthContractSummary(
  health: NormalizedQuickBooksServiceHealthProbeResponseEnvelope
): QuickBooksContractSmokeSnapshot["erpContracts"]["health"] {
  return {
    status: health.status,
    serviceAvailability: health.serviceAvailability,
    providerMode: health.providerMode,
    ...(health.serviceEnvironment === undefined ? {} : { serviceEnvironment: health.serviceEnvironment }),
    capabilityStatuses: Object.fromEntries(
      Object.entries(health.capabilities).map(([capability, value]) => [capability, value.status])
    ) as QuickBooksContractSmokeSnapshot["erpContracts"]["health"]["capabilityStatuses"],
    checkpoint: {
      ...(health.checkpoint.checkpointId === undefined ? {} : { checkpointId: health.checkpoint.checkpointId }),
      status: health.checkpoint.status,
      ...(health.checkpoint.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: health.checkpoint.sourceFreshThrough }),
      ...(health.checkpoint.importedThrough === undefined ? {} : { importedThrough: health.checkpoint.importedThrough }),
      ...(health.checkpoint.latestSourceUpdatedAt === undefined
        ? {}
        : { latestSourceUpdatedAt: health.checkpoint.latestSourceUpdatedAt })
    },
    issueCount: health.issues?.length ?? 0
  };
}

function normalizedResourceCounts(resources: NormalizedQuickBooksResourceSet): Readonly<Record<string, number>> {
  return {
    companyInfo: 1,
    accounts: resources.accounts.length,
    journalEntries: resources.journalEntries?.length ?? 0,
    ledgerTransactions: resources.ledgerTransactions?.length ?? 0,
    ledgerPostings: resources.ledgerPostings?.length ?? 0,
    parties: resources.parties?.length ?? 0,
    customers: resources.customers?.length ?? 0,
    vendors: resources.vendors?.length ?? 0,
    items: resources.items?.length ?? 0,
    classes: resources.classes?.length ?? 0,
    departments: resources.departments?.length ?? 0,
    dimensions: resources.dimensions?.length ?? 0,
    providerReports: resources.providerReports?.length ?? 0,
    reconciliationEvidence: resources.reconciliationEvidence?.length ?? 0
  };
}

function ledgerPostingTotals(postings: readonly LedgerPosting[]): QuickBooksContractSmokeSnapshot["canonicalPostingTotals"] {
  const totals = postings.reduce(
    (sum, posting) => ({
      debitMinor: sum.debitMinor + decimalToMinor(posting.debitAmount),
      creditMinor: sum.creditMinor + decimalToMinor(posting.creditAmount),
      netMinor: sum.netMinor + decimalToMinor(posting.netAmount)
    }),
    { debitMinor: 0n, creditMinor: 0n, netMinor: 0n }
  );

  return {
    debitTotal: minorToDecimal(totals.debitMinor),
    creditTotal: minorToDecimal(totals.creditMinor),
    netTotal: minorToDecimal(totals.netMinor)
  };
}

function reportTotals(report: BuiltReport): QuickBooksContractSmokeReportTotals {
  return totalsByKey(report.totals.map((total) => [total.totalKey, total.amount]));
}

function totalsByKey(entries: readonly (readonly [string, DecimalString])[]): QuickBooksContractSmokeReportTotals {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function minIsoDate(values: readonly IsoDate[]): IsoDate | undefined {
  return values.reduce<IsoDate | undefined>((min, value) => (min === undefined || value < min ? value : min), undefined);
}

function maxIsoDate(values: readonly IsoDate[]): IsoDate | undefined {
  return values.reduce<IsoDate | undefined>((max, value) => (max === undefined || value > max ? value : max), undefined);
}

function maxIsoDateTime(values: readonly (IsoDateTime | undefined)[]): IsoDateTime | undefined {
  return values.reduce<IsoDateTime | undefined>((max, value) => {
    if (value === undefined) {
      return max;
    }
    return max === undefined || value > max ? value : max;
  }, undefined);
}

function decimalToMinor(value: DecimalString): bigint {
  const sign = value.startsWith("-") ? -1n : 1n;
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value;
  const [whole = "0", fractional = ""] = unsignedValue.split(".");
  return sign * (BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0").slice(0, 2)));
}

function minorToDecimal(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absoluteValue = value < 0n ? -value : value;
  return `${sign}${String(absoluteValue / 100n)}.${String(absoluteValue % 100n).padStart(2, "0")}`;
}

function defaultProviderReports(): readonly NormalizedQuickBooksProviderReportResponseEnvelope[] {
  const { providerReports } = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES;
  return [
    providerReports.profitAndLoss.response,
    providerReports.balanceSheet.response,
    providerReports.trialBalance.response,
    providerReports.cashFlow.response
  ];
}
