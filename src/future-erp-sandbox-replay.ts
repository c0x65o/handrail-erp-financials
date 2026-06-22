import { assertNoCredentialKeys, assertSafeDrilldownRef, assertSafeSourcePayloadRef } from "./canonical-model.js";
import type {
  AccountingBasis,
  CursorKind,
  DecimalString,
  ImportBatchMode,
  ImportBatchStatus,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  SyncCheckpointStatus,
  ReconciliationStatus,
  ReportFreshnessStatus,
  SafeSourcePayloadRef
} from "./canonical-model.js";
import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  type NormalizedQuickBooksSyncFixtureSet
} from "./fixtures.js";
import {
  buildFutureErpReportFromCanonicalReadModel,
  fetchFutureErpQuickBooksProviderReportParitySnapshot
} from "./future-erp-reporting.js";
import type {
  FutureErpCanonicalReportSnapshotStorage,
  FutureErpQuickBooksProviderReportParityClient,
  FutureErpQuickBooksProviderReportParityStatus
} from "./future-erp-reporting.js";
import { createFutureErpQuickBooksFullSyncWorker } from "./future-erp-quickbooks-full-sync.js";
import type { FutureErpQuickBooksFullSyncClient, FutureErpQuickBooksFullSyncRunResult } from "./future-erp-quickbooks-full-sync.js";
import type {
  NormalizedQuickBooksBalanceSheetReportRequestEnvelope,
  NormalizedQuickBooksCashFlowParityReportRequestEnvelope,
  NormalizedQuickBooksFullSyncRequestEnvelope,
  NormalizedQuickBooksProfitAndLossReportRequestEnvelope,
  NormalizedQuickBooksTrialBalanceReportRequestEnvelope
} from "./normalized-accounting-contracts.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";
import type {
  LoadReportBuilderInput,
  PostgresQueryClient,
  PostgresQueryResult,
  PostgresStorageAdapter,
  ReportFreshnessRow,
  RollupBucket,
  StoredReportSnapshot
} from "./postgres-storage.js";
import type { BuiltReport, CashFlowActivity, CashFlowBuilderInput, ReportBuilderInput, ReportName } from "./report-builders.js";

export type FutureErpQuickBooksSandboxReplayClient = FutureErpQuickBooksFullSyncClient &
  FutureErpQuickBooksProviderReportParityClient;

export type FutureErpQuickBooksSandboxReplayReportStatus = "generated" | "supported" | "partial" | "unsupported";

export type FutureErpQuickBooksSandboxReplayDrilldownRef = {
  readonly refId: string;
  readonly postingCount?: number;
  readonly postingIds?: readonly string[];
  readonly accountIds?: readonly string[];
  readonly dimensionHash?: string;
  readonly query?: {
    readonly kind: "ledger_postings";
    readonly tenantId?: string;
    readonly sourceId?: string;
    readonly accountingBasis?: AccountingBasis;
    readonly periodStart?: IsoDate;
    readonly periodEnd?: IsoDate;
    readonly accountIds?: readonly string[];
    readonly dimensionHash?: string;
  };
  readonly sourceRefCount?: number;
  readonly sourceRefs?: readonly SafeSourcePayloadRef[];
};

export type FutureErpQuickBooksSandboxReplayCanonicalRowCounts = {
  readonly companies: number;
  readonly sources: number;
  readonly importBatches: number;
  readonly checkpoints: number;
  readonly accounts: number;
  readonly parties: number;
  readonly items: number;
  readonly dimensions: number;
  readonly transactions: number;
  readonly transactionLines: number;
  readonly postings: number;
};

export type FutureErpQuickBooksSandboxReplaySafeDrilldownRefs = {
  readonly reportSnapshotRef: SafeSourcePayloadRef;
  readonly lineRefs: readonly FutureErpQuickBooksSandboxReplayDrilldownRef[];
  readonly totalRefs: readonly FutureErpQuickBooksSandboxReplayDrilldownRef[];
  readonly reconciliationDifferenceRef: FutureErpQuickBooksSandboxReplayDrilldownRef;
};

export type FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata = {
  readonly tenantId: string;
  readonly sourceId: string;
  readonly sourceSystem: "quickbooks";
  readonly providerEnvironment: "sandbox" | "production";
  readonly sourceCompanyRef: string;
  readonly realmId: string;
  readonly connectionRef: string;
  readonly handrailQuickBooksServiceEnvironment: string;
};

export type FutureErpQuickBooksSandboxReplayImportBatchSummary = {
  readonly importBatchId: string;
  readonly mode?: ImportBatchMode;
  readonly status?: ImportBatchStatus;
  readonly startedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
};

export type FutureErpQuickBooksSandboxReplayCheckpointSummary = {
  readonly checkpointId: string;
  readonly sourceObject: string;
  readonly cursorKind: CursorKind;
  readonly cursorValue: string;
  readonly freshThrough?: IsoDateTime;
  readonly latestSourceUpdatedAt?: IsoDateTime;
  readonly status?: SyncCheckpointStatus;
};

export type FutureErpQuickBooksSandboxReplayReportResult = {
  readonly reportName: ReportName;
  readonly status: FutureErpQuickBooksSandboxReplayReportStatus;
  readonly freshnessStatus: ReportFreshnessStatus;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly reconciliationDifference: DecimalString;
  readonly snapshotId: string;
  readonly freshnessId: string;
  readonly lineCount: number;
  readonly totalCount: number;
  readonly snapshotRowsWritten: number;
  readonly freshnessRowsWritten: number;
  readonly safeDrilldownRefs: FutureErpQuickBooksSandboxReplaySafeDrilldownRefs;
};

export type FutureErpQuickBooksSandboxReplayParityReportResult = {
  readonly reportName: ReportName;
  readonly status: FutureErpQuickBooksProviderReportParityStatus;
  readonly reconciliationStatus?: ReconciliationStatus;
  readonly reconciliationDifference?: DecimalString;
  readonly reconciliationDifferenceDrilldownRef?: FutureErpQuickBooksSandboxReplayDrilldownRef;
  readonly evidenceTotalCount: number;
  readonly unsupportedReason?: string;
  readonly unavailableReason?: string;
};

export type FutureErpQuickBooksSandboxReplayResult = {
  readonly importBatchId: string;
  readonly checkpointId: string;
  readonly sourceIdentity: FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata;
  readonly importBatch: FutureErpQuickBooksSandboxReplayImportBatchSummary;
  readonly checkpoint: FutureErpQuickBooksSandboxReplayCheckpointSummary;
  readonly normalizedResourceCounts: Readonly<Record<string, number>>;
  readonly canonicalRowCounts: FutureErpQuickBooksSandboxReplayCanonicalRowCounts;
  readonly reportStatuses: Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplayReportStatus>>;
  readonly reports: Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplayReportResult>>;
  readonly snapshotIds: Readonly<Record<ReportName, string>>;
  readonly freshnessIds: Readonly<Record<ReportName, string>>;
  readonly parityStatuses: Readonly<Record<ReportName, FutureErpQuickBooksProviderReportParityStatus>>;
  readonly providerParity: {
    readonly status: FutureErpQuickBooksProviderReportParityStatus;
    readonly reports: readonly FutureErpQuickBooksSandboxReplayParityReportResult[];
  };
  readonly safeDrilldownRefs: Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplaySafeDrilldownRefs>>;
};

export type FutureErpCanonicalReportSnapshotGenerationResult = {
  readonly reportStatuses: Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplayReportStatus>>;
  readonly reports: Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplayReportResult>>;
  readonly builtReports: Readonly<Record<ReportName, BuiltReport>>;
  readonly snapshotIds: Readonly<Record<ReportName, string>>;
  readonly freshnessIds: Readonly<Record<ReportName, string>>;
  readonly safeDrilldownRefs: Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplaySafeDrilldownRefs>>;
};

export type FutureErpCanonicalReportSnapshotGenerationOptions = {
  readonly storage: Pick<PostgresStorageAdapter, "writeReportSnapshot" | "writeFreshnessRows">;
  readonly importResult: FutureErpQuickBooksFullSyncRunResult;
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly generatedAt: IsoDateTime;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate: IsoDate;
  readonly cashFlow?: Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId">;
  readonly maxDrilldownRefsPerReport?: number;
};

export type FutureErpQuickBooksSandboxReplayOptions = {
  readonly postgresClient?: PostgresQueryClient;
  readonly postgresStorage?: PostgresStorageAdapter;
  readonly quickBooksClient?: FutureErpQuickBooksSandboxReplayClient;
  readonly fullSyncRequest?: NormalizedQuickBooksFullSyncRequestEnvelope;
  readonly companyId?: string;
  readonly accountingBasis?: AccountingBasis;
  readonly currencyCode?: IsoCurrencyCode;
  readonly importedAt?: IsoDateTime;
  readonly generatedAt?: IsoDateTime;
  readonly requestedAt?: IsoDateTime;
  readonly comparedAt?: IsoDateTime;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly asOfDate?: IsoDate;
  readonly toleranceAmount?: DecimalString;
  readonly cashFlow?: Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId">;
  readonly maxDrilldownRefsPerReport?: number;
};

const SANDBOX_REPORT_NAMES: readonly ReportName[] = ["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"];
const DEFAULT_COMPANY_ID = "company_future_erp_qbo_fixture";
const DEFAULT_ACCOUNTING_BASIS: AccountingBasis = "accrual";
const DEFAULT_CURRENCY_CODE: IsoCurrencyCode = "USD";
const DEFAULT_IMPORTED_AT: IsoDateTime = "2026-02-01T10:15:00.000Z";
const DEFAULT_GENERATED_AT: IsoDateTime = "2026-02-01T10:15:00.000Z";
const DEFAULT_REQUESTED_AT: IsoDateTime = "2026-02-01T10:16:00.000Z";
const DEFAULT_COMPARED_AT: IsoDateTime = "2026-02-01T10:17:00.000Z";
const DEFAULT_PERIOD_START: IsoDate = "2026-01-01";
const DEFAULT_PERIOD_END: IsoDate = "2026-01-31";
const DEFAULT_AS_OF_DATE: IsoDate = "2026-01-31";
const DEFAULT_TOLERANCE_AMOUNT: DecimalString = "0.00";
const DEFAULT_MAX_DRILLDOWN_REFS_PER_REPORT = 4;

export async function runFutureErpQuickBooksSandboxReplay(
  options: FutureErpQuickBooksSandboxReplayOptions = {}
): Promise<FutureErpQuickBooksSandboxReplayResult> {
  const fixtureSet = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES;
  const postgresStorage =
    options.postgresStorage ?? createPostgresStorageAdapter(options.postgresClient ?? new RecordingSandboxPostgresClient());
  const quickBooksClient = options.quickBooksClient ?? new FixtureQuickBooksSandboxReplayClient(fixtureSet);
  const accountingBasis = options.accountingBasis ?? DEFAULT_ACCOUNTING_BASIS;
  const currencyCode = options.currencyCode ?? DEFAULT_CURRENCY_CODE;
  const importedAt = options.importedAt ?? DEFAULT_IMPORTED_AT;
  const generatedAt = options.generatedAt ?? DEFAULT_GENERATED_AT;
  const periodStart = options.periodStart ?? DEFAULT_PERIOD_START;
  const periodEnd = options.periodEnd ?? DEFAULT_PERIOD_END;
  const asOfDate = options.asOfDate ?? DEFAULT_AS_OF_DATE;
  const importWorker = createFutureErpQuickBooksFullSyncWorker({
    quickBooksClient,
    persistence: postgresStorage,
    companyId: options.companyId ?? DEFAULT_COMPANY_ID,
    accountingBasis,
    currencyCode,
    importedAt,
    handrailQuickBooksServiceEnvironment: "staging"
  });
  const importResult = await importWorker.fullSync(options.fullSyncRequest ?? fixtureSet.fullSync.request);
  const reportGeneration = await generateFutureErpCanonicalReportSnapshotsFromImport({
    storage: postgresStorage,
    importResult,
    accountingBasis,
    currencyCode,
    generatedAt,
    periodStart,
    periodEnd,
    asOfDate,
    ...(options.cashFlow === undefined ? {} : { cashFlow: options.cashFlow }),
    maxDrilldownRefsPerReport: options.maxDrilldownRefsPerReport ?? DEFAULT_MAX_DRILLDOWN_REFS_PER_REPORT
  });
  const paritySnapshot = await fetchFutureErpQuickBooksProviderReportParitySnapshot({
    client: quickBooksClient,
    sourceIdentity: importResult.response.sourceIdentity,
    accountingBasis,
    currencyCode,
    periodStart,
    periodEnd,
    asOfDate,
    requestedAt: options.requestedAt ?? DEFAULT_REQUESTED_AT,
    comparedAt: options.comparedAt ?? DEFAULT_COMPARED_AT,
    toleranceAmount: options.toleranceAmount ?? DEFAULT_TOLERANCE_AMOUNT,
    reports: reportGeneration.builtReports
  });
  const result: FutureErpQuickBooksSandboxReplayResult = {
    importBatchId: importResult.persistence.importBatchId,
    checkpointId: importResult.persistence.checkpointId,
    sourceIdentity: safeSourceIdentityMetadata(importResult),
    importBatch: importBatchSummary(importResult),
    checkpoint: checkpointSummary(importResult),
    normalizedResourceCounts: importResult.response.resourceCounts,
    canonicalRowCounts: canonicalRowCounts(importResult),
    reportStatuses: reportGeneration.reportStatuses,
    reports: reportGeneration.reports,
    snapshotIds: reportGeneration.snapshotIds,
    freshnessIds: reportGeneration.freshnessIds,
    parityStatuses: Object.fromEntries(paritySnapshot.reports.map((report) => [report.reportName, report.status])) as Readonly<
      Record<ReportName, FutureErpQuickBooksProviderReportParityStatus>
    >,
    providerParity: {
      status: paritySnapshot.status,
      reports: paritySnapshot.reports.map((report): FutureErpQuickBooksSandboxReplayParityReportResult => {
        if (report.reconciliationDifferenceDrilldownRef !== undefined) {
          assertSafeDrilldownRef(report.reconciliationDifferenceDrilldownRef);
        }

        return {
          reportName: report.reportName,
          status: report.status,
          ...(report.reconciliationStatus === undefined ? {} : { reconciliationStatus: report.reconciliationStatus }),
          ...(report.reconciliationDifference === undefined ? {} : { reconciliationDifference: report.reconciliationDifference }),
          ...(report.reconciliationDifferenceDrilldownRef === undefined
            ? {}
            : { reconciliationDifferenceDrilldownRef: sanitizeDrilldownRef(report.reconciliationDifferenceDrilldownRef) }),
          evidenceTotalCount: report.evidence?.totals.length ?? 0,
          ...(report.unsupportedReason === undefined ? {} : { unsupportedReason: report.unsupportedReason }),
          ...(report.unavailableReason === undefined ? {} : { unavailableReason: report.unavailableReason })
        };
      })
    },
    safeDrilldownRefs: reportGeneration.safeDrilldownRefs
  };

  assertReplayResultContainsNoDisallowedKeys(result);
  assertNoCredentialKeys(result);

  return result;
}

export async function generateFutureErpCanonicalReportSnapshotsFromImport(
  options: FutureErpCanonicalReportSnapshotGenerationOptions
): Promise<FutureErpCanonicalReportSnapshotGenerationResult> {
  const reportStorage = new SandboxReplayReportStorage(options.storage, options.importResult);
  const reportResults = await buildSandboxReplayReports({
    storage: reportStorage,
    importResult: options.importResult,
    accountingBasis: options.accountingBasis,
    currencyCode: options.currencyCode,
    generatedAt: options.generatedAt,
    periodStart: options.periodStart,
    periodEnd: options.periodEnd,
    asOfDate: options.asOfDate,
    cashFlow: options.cashFlow ?? deriveCashFlowOptions(options.importResult),
    maxDrilldownRefsPerReport: options.maxDrilldownRefsPerReport ?? DEFAULT_MAX_DRILLDOWN_REFS_PER_REPORT
  });

  return {
    reportStatuses: mapValues(reportResults, (report) => report.status),
    reports: reportResults,
    builtReports: mapValues(reportResults, (reportResult) => reportStorage.reportBySnapshotId(reportResult.snapshotId)),
    snapshotIds: mapValues(reportResults, (report) => report.snapshotId),
    freshnessIds: mapValues(reportResults, (report) => report.freshnessId),
    safeDrilldownRefs: mapValues(reportResults, (report) => report.safeDrilldownRefs)
  };
}

function safeSourceIdentityMetadata(
  importResult: FutureErpQuickBooksFullSyncRunResult
): FutureErpQuickBooksSandboxReplaySafeSourceIdentityMetadata {
  const identity = importResult.response.sourceIdentity;

  return {
    tenantId: identity.tenantId,
    sourceId: identity.sourceId,
    sourceSystem: "quickbooks",
    providerEnvironment: identity.providerEnvironment,
    sourceCompanyRef: identity.sourceCompanyRef,
    realmId: identity.realmId,
    connectionRef: importResult.facts.source.connectionRef,
    handrailQuickBooksServiceEnvironment: importResult.adapterInput.context.runtimeConfig?.serviceEnvironment ?? "staging"
  };
}

function importBatchSummary(importResult: FutureErpQuickBooksFullSyncRunResult): FutureErpQuickBooksSandboxReplayImportBatchSummary {
  const importBatch = importResult.facts.importBatch;

  return {
    importBatchId: importBatch.importBatchId,
    mode: importBatch.mode,
    status: importBatch.status,
    startedAt: importBatch.startedAt,
    ...(importBatch.completedAt === undefined ? {} : { completedAt: importBatch.completedAt })
  };
}

function checkpointSummary(importResult: FutureErpQuickBooksFullSyncRunResult): FutureErpQuickBooksSandboxReplayCheckpointSummary {
  const checkpoint = importResult.facts.checkpoint;

  return {
    checkpointId: checkpoint.checkpointId,
    sourceObject: checkpoint.sourceObject,
    cursorKind: checkpoint.cursorKind,
    cursorValue: checkpoint.cursorValue,
    ...(checkpoint.freshThrough === undefined ? {} : { freshThrough: checkpoint.freshThrough }),
    ...(checkpoint.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: checkpoint.latestSourceUpdatedAt }),
    status: checkpoint.status
  };
}

class SandboxReplayReportStorage implements FutureErpCanonicalReportSnapshotStorage {
  private readonly reportsBySnapshotId = new Map<string, BuiltReport>();

  constructor(
    private readonly postgresStorage: Pick<PostgresStorageAdapter, "writeReportSnapshot" | "writeFreshnessRows">,
    private readonly importResult: FutureErpQuickBooksFullSyncRunResult
  ) {}

  loadReportBuilderInput(input: LoadReportBuilderInput): Promise<ReportBuilderInput> {
    const freshThrough = this.importResult.facts.checkpoint.freshThrough;

    return Promise.resolve({
      tenantId: input.tenantId,
      accounts: this.importResult.facts.accounts,
      postings: this.importResult.facts.postings,
      accountingBasis: input.accountingBasis,
      sourceId: input.sourceId,
      currencyCode: input.currencyCode,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      ...(input.asOfDate === undefined ? {} : { asOfDate: input.asOfDate }),
      ...(input.generatedAt === undefined ? {} : { generatedAt: input.generatedAt }),
      freshness: {
        status: "fresh",
        sourceId: this.importResult.facts.source.sourceId,
        importBatchId: this.importResult.facts.importBatch.importBatchId,
        checkpointId: this.importResult.facts.checkpoint.checkpointId,
        ...(freshThrough === undefined ? {} : { freshThrough })
      }
    });
  }

  loadLatestReportSnapshot(): Promise<StoredReportSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  loadRollupBuckets(): Promise<readonly RollupBucket[]> {
    return Promise.resolve([]);
  }

  async writeReportSnapshot(report: BuiltReport): Promise<number> {
    this.reportsBySnapshotId.set(report.snapshot.reportSnapshotId, report);

    return this.postgresStorage.writeReportSnapshot(report);
  }

  writeFreshnessRows(rows: readonly ReportFreshnessRow[]): Promise<number> {
    return this.postgresStorage.writeFreshnessRows(rows);
  }

  reportBySnapshotId(snapshotId: string): BuiltReport {
    const report = this.reportsBySnapshotId.get(snapshotId);
    if (report === undefined) {
      throw new Error(`sandbox replay report was not persisted for snapshot ${snapshotId}`);
    }
    return report;
  }
}

class FixtureQuickBooksSandboxReplayClient implements FutureErpQuickBooksSandboxReplayClient {
  constructor(private readonly fixtures: NormalizedQuickBooksSyncFixtureSet) {}

  fullSync() {
    return Promise.resolve(this.fixtures.fullSync.response);
  }

  profitAndLossReport(_request?: NormalizedQuickBooksProfitAndLossReportRequestEnvelope) {
    void _request;
    return Promise.resolve(this.fixtures.providerReports.profitAndLoss.response);
  }

  balanceSheetReport(_request?: NormalizedQuickBooksBalanceSheetReportRequestEnvelope) {
    void _request;
    return Promise.resolve(this.fixtures.providerReports.balanceSheet.response);
  }

  trialBalanceReport(_request?: NormalizedQuickBooksTrialBalanceReportRequestEnvelope) {
    void _request;
    return Promise.resolve(this.fixtures.providerReports.trialBalance.response);
  }

  cashFlowParityReport(_request?: NormalizedQuickBooksCashFlowParityReportRequestEnvelope) {
    void _request;
    return Promise.resolve(this.fixtures.providerReports.cashFlow.response);
  }
}

class RecordingSandboxPostgresClient implements PostgresQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<PostgresQueryResult<Row>> {
    return Promise.resolve({
      rows: [],
      rowCount: null
    });
  }
}

async function buildSandboxReplayReports(input: {
  readonly storage: FutureErpCanonicalReportSnapshotStorage;
  readonly importResult: FutureErpQuickBooksFullSyncRunResult;
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly generatedAt: IsoDateTime;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate: IsoDate;
  readonly cashFlow: Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId">;
  readonly maxDrilldownRefsPerReport: number;
}): Promise<Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplayReportResult>>> {
  const reports: Partial<Record<ReportName, FutureErpQuickBooksSandboxReplayReportResult>> = {};

  for (const reportName of SANDBOX_REPORT_NAMES) {
    const freshThrough = input.importResult.facts.checkpoint.freshThrough;
    const result = await buildFutureErpReportFromCanonicalReadModel(input.storage, {
      tenantId: input.importResult.facts.company.tenantId,
      companyId: input.importResult.facts.company.companyId,
      sourceId: input.importResult.facts.source.sourceId,
      reportName,
      accountingBasis: input.accountingBasis,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      asOfDate: input.asOfDate,
      currencyCode: input.currencyCode,
      generatedAt: input.generatedAt,
      preferStoredSnapshot: false,
      persistGeneratedSnapshot: true,
      ...(reportName === "cash_flow" ? { cashFlow: input.cashFlow } : {}),
      ...(freshThrough === undefined
        ? {}
        : {
            sourceFreshThrough: freshThrough,
            importedThrough: freshThrough
          }),
      importBatchId: input.importResult.facts.importBatch.importBatchId,
      checkpointId: input.importResult.facts.checkpoint.checkpointId,
      tenantAccess: {
        tenantId: input.importResult.facts.company.tenantId,
        sourceIds: [input.importResult.facts.source.sourceId]
      }
    });
    const persistence = result.persistence;
    if (persistence === undefined) {
      throw new Error(`sandbox replay expected ${reportName} snapshot persistence`);
    }
    reports[reportName] = {
      reportName,
      status: reportStatus(result.report),
      freshnessStatus: result.report.snapshot.freshness.status,
      reconciliationStatus: result.report.metadata.reconciliationStatus,
      reconciliationDifference: result.report.metadata.reconciliationDifference,
      snapshotId: persistence.snapshotId,
      freshnessId: persistence.freshnessRow.freshnessId,
      lineCount: result.report.lines.length,
      totalCount: result.report.totals.length,
      snapshotRowsWritten: persistence.snapshotRowsWritten,
      freshnessRowsWritten: persistence.freshnessRowsWritten,
      safeDrilldownRefs: boundedSafeDrilldownRefs(result, input.maxDrilldownRefsPerReport)
    };
  }

  return reports as Readonly<Record<ReportName, FutureErpQuickBooksSandboxReplayReportResult>>;
}

function canonicalRowCounts(
  importResult: FutureErpQuickBooksFullSyncRunResult
): FutureErpQuickBooksSandboxReplayCanonicalRowCounts {
  return {
    companies: importResult.persistence.companies,
    sources: importResult.persistence.sources,
    importBatches: importResult.persistence.importBatches,
    checkpoints: importResult.persistence.checkpoints,
    accounts: importResult.persistence.accounts,
    parties: importResult.persistence.parties,
    items: importResult.persistence.items,
    dimensions: importResult.persistence.dimensions,
    transactions: importResult.persistence.transactions,
    transactionLines: importResult.persistence.transactionLines,
    postings: importResult.persistence.postings
  };
}

function deriveCashFlowOptions(
  importResult: FutureErpQuickBooksFullSyncRunResult
): Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId"> {
  const cashAccountIds = importResult.facts.accounts
    .filter(
      (account) =>
        account.active &&
        account.classification === "asset" &&
        (account.type.toLowerCase() === "bank" || account.subtype?.toLowerCase().includes("checking") === true)
    )
    .map((account) => account.accountId);
  const activityByAccountId = Object.fromEntries(
    importResult.facts.accounts
      .filter((account) => !cashAccountIds.includes(account.accountId))
      .map((account): readonly [string, Exclude<CashFlowActivity, "unclassified">] => [
        account.accountId,
        cashFlowActivityForAccount(account.classification)
      ])
  );

  return {
    cashAccountIds,
    activityByAccountId
  };
}

function cashFlowActivityForAccount(classification: string): Exclude<CashFlowActivity, "unclassified"> {
  if (classification === "liability" || classification === "equity") {
    return "financing";
  }
  if (classification === "asset") {
    return "investing";
  }
  return "operating";
}

function reportStatus(report: BuiltReport): FutureErpQuickBooksSandboxReplayReportStatus {
  return report.metadata.cashFlow?.supportStatus ?? "generated";
}

function boundedSafeDrilldownRefs(
  result: Awaited<ReturnType<typeof buildFutureErpReportFromCanonicalReadModel>>,
  maxRefs: number
): FutureErpQuickBooksSandboxReplaySafeDrilldownRefs {
  assertSafeSourcePayloadRef(result.drilldownSurface.reportSnapshotRef);
  assertSafeDrilldownRef(result.drilldownSurface.reconciliationDifference.drilldownRef);
  for (const line of result.drilldownSurface.lines) {
    assertSafeDrilldownRef(line.drilldownRef);
  }
  for (const total of result.drilldownSurface.totals) {
    assertSafeDrilldownRef(total.drilldownRef);
  }

  return {
    reportSnapshotRef: result.drilldownSurface.reportSnapshotRef,
    lineRefs: result.drilldownSurface.lines.slice(0, maxRefs).map((line) => sanitizeDrilldownRef(line.drilldownRef)),
    totalRefs: result.drilldownSurface.totals.slice(0, maxRefs).map((total) => sanitizeDrilldownRef(total.drilldownRef)),
    reconciliationDifferenceRef: sanitizeDrilldownRef(result.drilldownSurface.reconciliationDifference.drilldownRef)
  };
}

function sanitizeDrilldownRef(ref: Parameters<typeof assertSafeDrilldownRef>[0]): FutureErpQuickBooksSandboxReplayDrilldownRef {
  assertSafeDrilldownRef(ref);

  return {
    refId: ref.token,
    ...(ref.postingCount === undefined ? {} : { postingCount: ref.postingCount }),
    ...(ref.postingIds === undefined ? {} : { postingIds: ref.postingIds }),
    ...(ref.accountIds === undefined ? {} : { accountIds: ref.accountIds }),
    ...(ref.dimensionHash === undefined ? {} : { dimensionHash: ref.dimensionHash }),
    ...(ref.query === undefined ? {} : { query: ref.query }),
    ...(ref.sourceRefCount === undefined ? {} : { sourceRefCount: ref.sourceRefCount }),
    ...(ref.sourceRefs === undefined ? {} : { sourceRefs: ref.sourceRefs })
  };
}

function mapValues<Value, Mapped>(
  values: Readonly<Record<ReportName, Value>>,
  mapper: (value: Value, reportName: ReportName) => Mapped
): Readonly<Record<ReportName, Mapped>> {
  return Object.fromEntries(SANDBOX_REPORT_NAMES.map((reportName) => [reportName, mapper(values[reportName], reportName)])) as Readonly<
    Record<ReportName, Mapped>
  >;
}

function assertReplayResultContainsNoDisallowedKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertReplayResultContainsNoDisallowedKeys(entry, `${path}[${String(index)}]`);
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|credential|rawPayload|rawProviderPayload/i.test(key)) {
        throw new Error(`sandbox replay result contains a disallowed field at ${path}.${key}`);
      }
      assertReplayResultContainsNoDisallowedKeys(entry, `${path}.${key}`);
    }
  }
}
