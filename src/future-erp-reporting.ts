import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "./report-builders.js";
import {
  buildQuickBooksBalanceSheetReconciliationEvidence,
  buildNormalizedQuickBooksProviderReportResponse,
  buildQuickBooksProfitAndLossReconciliationEvidence,
  buildQuickBooksProviderReportReconciliationEvidence,
  buildQuickBooksTrialBalanceReconciliationEvidence
} from "./quickbooks-sync-service.js";
import { createSnapshotRefreshContract, reconcileReportFreshness } from "./rollup-jobs.js";
import { assertNoCredentialKeys, assertSafeSourcePayloadRef, createCompactDrilldownRef } from "./canonical-model.js";
import type {
  DecimalString,
  DrilldownRef,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  ReconciliationStatus,
  ReportFreshness,
  ReportSnapshotId,
  SafeSourcePayloadRef,
  SourceId,
  TenantId
} from "./canonical-model.js";
import type {
  NormalizedAccountingReconciliationEvidence,
  NormalizedQuickBooksCanonicalReportTotal,
  NormalizedQuickBooksProviderReportRef,
  NormalizedQuickBooksProviderReportName,
  NormalizedQuickBooksProviderReportRequestEnvelope,
  NormalizedQuickBooksProviderReportResponseEnvelope,
  NormalizedQuickBooksSourceIdentity
} from "./normalized-accounting-contracts.js";
import type { HandrailQuickBooksFullSyncServiceHandler } from "./quickbooks-sync-service.js";
import type { BuiltReport, CashFlowBuilderInput, CashFlowMetadata, ReportBuilderInput, ReportName } from "./report-builders.js";
import type {
  LoadReportBuilderInput,
  LoadReportSnapshotInput,
  LoadRollupBucketsInput,
  PostgresStorageAdapter,
  ReportFreshnessRow,
  RollupBucket,
  StoredReportSnapshot
} from "./postgres-storage.js";

export type FutureErpCanonicalReportReadModelStorage = Pick<
  PostgresStorageAdapter,
  "loadReportBuilderInput" | "loadLatestReportSnapshot" | "loadRollupBuckets"
>;

export type FutureErpCanonicalReportSnapshotStorage = FutureErpCanonicalReportReadModelStorage &
  Pick<PostgresStorageAdapter, "writeReportSnapshot" | "writeFreshnessRows">;

export type FutureErpCanonicalReportGenerationRequest = LoadReportBuilderInput & {
  readonly tenantAccess?: FutureErpTenantReadAccess;
  readonly preferStoredSnapshot?: boolean;
  readonly persistGeneratedSnapshot?: boolean;
  readonly rollupBucketRequest?: LoadRollupBucketsInput;
  readonly cashFlow?: Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId">;
  readonly sourceFreshThrough?: IsoDateTime;
  readonly importedThrough?: IsoDateTime;
  readonly staleReasons?: readonly string[];
  readonly importBatchId?: string;
  readonly checkpointId?: string;
};

export type FutureErpTenantReadAccess = {
  readonly tenantId: TenantId;
  readonly sourceIds?: readonly SourceId[];
};

export type FutureErpReportDrilldownSurfaceEntry = {
  readonly id: string;
  readonly label: string;
  readonly amount: DecimalString;
  readonly drilldownRef: DrilldownRef;
};

export type FutureErpReportReconciliationDrilldownSurface = {
  readonly status: ReconciliationStatus;
  readonly difference: DecimalString;
  readonly drilldownRef: DrilldownRef;
};

export type FutureErpReportDrilldownSurface = {
  readonly tenantId: TenantId;
  readonly reportSnapshotId: ReportSnapshotId;
  readonly reportSnapshotRef: SafeSourcePayloadRef;
  readonly lines: readonly FutureErpReportDrilldownSurfaceEntry[];
  readonly totals: readonly FutureErpReportDrilldownSurfaceEntry[];
  readonly reconciliationDifference: FutureErpReportReconciliationDrilldownSurface;
};

export type FutureErpCanonicalReportGenerationResult = {
  readonly report: BuiltReport;
  readonly source: "report_snapshot" | "canonical_facts";
  readonly freshness?: ReportFreshness;
  readonly drilldownSurface: FutureErpReportDrilldownSurface;
  readonly persistence?: {
    readonly snapshotId: string;
    readonly freshnessRow: ReportFreshnessRow;
    readonly snapshotRowsWritten: number;
    readonly freshnessRowsWritten: number;
  };
  readonly rollupBuckets: readonly RollupBucket[];
};

export type FutureErpQuickBooksProviderReportParityStatus =
  | "matched"
  | "mismatched"
  | "partial"
  | "unsupported"
  | "unavailable";

export type FutureErpQuickBooksProviderReportParityClient = Pick<
  HandrailQuickBooksFullSyncServiceHandler,
  "profitAndLossReport" | "balanceSheetReport" | "trialBalanceReport" | "cashFlowParityReport"
>;

export type FutureErpQuickBooksProviderReportParityRequest = {
  readonly client: FutureErpQuickBooksProviderReportParityClient;
  readonly sourceIdentity: NormalizedQuickBooksSourceIdentity;
  readonly tenantAccess?: FutureErpTenantReadAccess;
  readonly accountingBasis: LoadReportBuilderInput["accountingBasis"];
  readonly currencyCode?: IsoCurrencyCode;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate: IsoDate;
  readonly requestedAt?: IsoDateTime;
  readonly comparedAt?: IsoDateTime;
  readonly toleranceAmount?: DecimalString;
  readonly reports?: Partial<Record<ReportName, BuiltReport>>;
  readonly canonicalTotalsByReport?: Partial<Record<ReportName, readonly NormalizedQuickBooksCanonicalReportTotal[]>>;
};

export type FutureErpQuickBooksProviderReportParityDelta = {
  readonly totalKey: string;
  readonly status: "matched" | "mismatched" | "missing";
  readonly canonicalAmount: DecimalString;
  readonly providerAmount: DecimalString;
  readonly difference: DecimalString;
  readonly absoluteDifference: DecimalString;
  readonly toleranceAmount: DecimalString;
  readonly providerDrilldownRef?: SafeSourcePayloadRef;
  readonly canonicalDrilldownRef?: DrilldownRef;
};

export type FutureErpQuickBooksProviderReportParityResult = {
  readonly reportName: NormalizedQuickBooksProviderReportName;
  readonly status: FutureErpQuickBooksProviderReportParityStatus;
  readonly request: NormalizedQuickBooksProviderReportRequestEnvelope;
  readonly providerReport?: NormalizedQuickBooksProviderReportResponseEnvelope;
  readonly providerReportRef?: NormalizedQuickBooksProviderReportRef;
  readonly toleranceAmount?: DecimalString;
  readonly deltas?: readonly FutureErpQuickBooksProviderReportParityDelta[];
  readonly reconciliationStatus?: ReconciliationStatus;
  readonly reconciliationDifference?: DecimalString;
  readonly reconciliationDifferenceDrilldownRef?: DrilldownRef;
  readonly evidence?: NormalizedAccountingReconciliationEvidence;
  readonly unsupportedReason?: NormalizedQuickBooksProviderReportResponseEnvelope["unsupportedReason"];
  readonly unavailableReason?: "quickbooks_provider_report_unavailable";
};

export type FutureErpQuickBooksProviderReportParitySnapshot = {
  readonly sourceIdentity: NormalizedQuickBooksSourceIdentity;
  readonly comparedAt?: IsoDateTime;
  readonly status: FutureErpQuickBooksProviderReportParityStatus;
  readonly reports: readonly FutureErpQuickBooksProviderReportParityResult[];
};

export async function buildFutureErpReportFromCanonicalReadModel(
  storage: FutureErpCanonicalReportReadModelStorage | FutureErpCanonicalReportSnapshotStorage,
  request: FutureErpCanonicalReportGenerationRequest
): Promise<FutureErpCanonicalReportGenerationResult> {
  assertFutureErpTenantReadAccess(request.tenantAccess, request.tenantId, request.sourceId);
  const cashFlowOptions = cashFlowOptionsForRequest(request);
  const snapshotRequest = reportSnapshotRequest(request);
  const storedSnapshot =
    request.preferStoredSnapshot === false ? undefined : await storage.loadLatestReportSnapshot(snapshotRequest);
  const rollupBuckets =
    request.rollupBucketRequest === undefined ? [] : await storage.loadRollupBuckets(request.rollupBucketRequest);

  if (storedSnapshot !== undefined && storedSnapshot.snapshot.freshness.status === "fresh") {
    const report = builtReportFromStoredSnapshot(storedSnapshot, cashFlowOptions);
    assertReportTenantScope(report, request.tenantId, "stored report snapshot");
    return {
      report,
      source: "report_snapshot",
      freshness: storedSnapshot.snapshot.freshness,
      drilldownSurface: buildFutureErpReportDrilldownSurface(report),
      rollupBuckets
    };
  }

  const reportInput = await storage.loadReportBuilderInput(request);
  assertReportInputTenantScope(reportInput, request.tenantId, request.sourceId);
  const report = buildReportFromCanonicalFacts(request.reportName, reportInput, cashFlowOptions);
  const persistence = await persistGeneratedReportSnapshot(storage, request, report);
  const persistedReport = persistence?.report ?? report;
  assertReportTenantScope(persistedReport, request.tenantId, "generated report");

  return {
    report: persistedReport,
    source: "canonical_facts",
    freshness: persistedReport.snapshot.freshness,
    drilldownSurface: buildFutureErpReportDrilldownSurface(persistedReport),
    ...(persistence === undefined
      ? {}
      : {
          persistence: {
            snapshotId: persistence.snapshotId,
            freshnessRow: persistence.freshnessRow,
            snapshotRowsWritten: persistence.snapshotRowsWritten,
            freshnessRowsWritten: persistence.freshnessRowsWritten
          }
        }),
    rollupBuckets
  };
}

function cashFlowOptionsForRequest(
  request: FutureErpCanonicalReportGenerationRequest
): FutureErpCanonicalReportGenerationRequest["cashFlow"] {
  if (request.reportName !== "cash_flow") {
    return undefined;
  }
  if (request.cashFlow === undefined) {
    throw new Error("cash_flow report generation requires cashFlow account classification options");
  }
  return request.cashFlow;
}

function buildReportFromCanonicalFacts(
  reportName: ReportName,
  input: ReportBuilderInput,
  cashFlowOptions: FutureErpCanonicalReportGenerationRequest["cashFlow"]
): BuiltReport {
  switch (reportName) {
    case "profit_and_loss":
      return buildProfitAndLossReport(input);
    case "balance_sheet":
      return buildBalanceSheetReport(input);
    case "trial_balance":
      return buildTrialBalanceReport(input);
    case "cash_flow":
      return buildCashFlowReport({
        ...input,
        cashAccountIds: cashFlowOptions?.cashAccountIds ?? [],
        activityByAccountId: cashFlowOptions?.activityByAccountId ?? {}
      });
  }
}

function builtReportFromStoredSnapshot(
  stored: StoredReportSnapshot,
  cashFlowOptions: FutureErpCanonicalReportGenerationRequest["cashFlow"]
): BuiltReport {
  const reportName = stored.snapshot.reportName as ReportName;

  return {
    snapshot: stored.snapshot,
    lines: stored.lines,
    totals: stored.totals,
    metadata: {
      reportName,
      generatedFrom: "report_snapshot",
      reconciliationStatus: stored.snapshot.reconciliationStatus,
      reconciliationDifference: stored.snapshot.reconciliationDifference,
      ...(reportName === "cash_flow" && cashFlowOptions !== undefined
        ? { cashFlow: cashFlowMetadataFromStoredSnapshot(stored, cashFlowOptions) }
        : {})
    }
  };
}

function cashFlowMetadataFromStoredSnapshot(
  stored: StoredReportSnapshot,
  cashFlowOptions: NonNullable<FutureErpCanonicalReportGenerationRequest["cashFlow"]>
): CashFlowMetadata {
  const unclassifiedTotal = stored.totals.find((total) => total.totalKey === "unclassified_cash_movement");
  const unclassifiedPostingIds = [
    ...new Set([
      ...(unclassifiedTotal?.drilldownRef.postingIds ?? []),
      ...stored.lines
        .filter((line) => line.section === "unclassified")
        .flatMap((line) => line.drilldownRef.postingIds ?? [])
    ])
  ].sort();
  const hasUnclassifiedMovement = unclassifiedTotal?.amount !== undefined && unclassifiedTotal.amount !== "0.00";
  const supportStatus =
    cashFlowOptions.cashAccountIds.length === 0 ? "unsupported" : hasUnclassifiedMovement ? "partial" : "supported";
  const unsupportedReasons =
    cashFlowOptions.cashAccountIds.length === 0
      ? ["cash_flow_requires_cash_account_ids"]
      : hasUnclassifiedMovement
        ? ["cash_flow_has_unclassified_cash_movement"]
        : [];

  return {
    supportStatus,
    derivationMethod: "cash_account_ledger_movement",
    cashAccountIds: cashFlowOptions.cashAccountIds,
    unsupportedReasons,
    unclassifiedCashMovementPostingIds: unclassifiedPostingIds
  };
}

function reportSnapshotRequest(request: FutureErpCanonicalReportGenerationRequest): LoadReportSnapshotInput {
  return {
    tenantId: request.tenantId,
    reportName: request.reportName,
    accountingBasis: request.accountingBasis,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    ...(request.asOfDate === undefined ? {} : { asOfDate: request.asOfDate }),
    currencyCode: request.currencyCode
  };
}

async function persistGeneratedReportSnapshot(
  storage: FutureErpCanonicalReportReadModelStorage | FutureErpCanonicalReportSnapshotStorage,
  request: FutureErpCanonicalReportGenerationRequest,
  report: BuiltReport
): Promise<
  | {
      readonly report: BuiltReport;
      readonly snapshotId: string;
      readonly freshnessRow: ReportFreshnessRow;
      readonly snapshotRowsWritten: number;
      readonly freshnessRowsWritten: number;
    }
  | undefined
> {
  if (request.persistGeneratedSnapshot !== true) {
    return undefined;
  }
  if (!isSnapshotStorage(storage)) {
    throw new Error("persistGeneratedSnapshot requires writeReportSnapshot and writeFreshnessRows storage methods");
  }

  const importedThrough = request.importedThrough ?? report.snapshot.freshness.freshThrough;
  const importBatchId = request.importBatchId ?? report.snapshot.freshness.importBatchId;
  const checkpointId = request.checkpointId ?? report.snapshot.freshness.checkpointId;
  const staleReasons = request.staleReasons ?? staleReasonsFromFreshness(report.snapshot.freshness);
  const snapshotContract = createSnapshotRefreshContract({
    tenantId: request.tenantId,
    companyId: request.companyId,
    sourceId: request.sourceId,
    reportName: request.reportName,
    accountingBasis: request.accountingBasis,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    asOfDate: request.asOfDate ?? request.periodEnd,
    currencyCode: request.currencyCode,
    generatedAt: request.generatedAt ?? report.snapshot.generatedAt,
    ...(importedThrough === undefined ? {} : { freshThrough: importedThrough }),
    ...(importBatchId === undefined ? {} : { importBatchId }),
    ...(checkpointId === undefined ? {} : { checkpointId })
  });
  const freshnessRow = reconcileReportFreshness({
    tenantId: request.tenantId,
    companyId: request.companyId,
    sourceId: request.sourceId,
    reportName: request.reportName,
    accountingBasis: request.accountingBasis,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    currencyCode: request.currencyCode,
    updatedAt: request.generatedAt ?? report.snapshot.generatedAt,
    ...(request.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: request.sourceFreshThrough }),
    ...(importedThrough === undefined ? {} : { importedThrough }),
    ...(importBatchId === undefined ? {} : { importBatchId }),
    ...(checkpointId === undefined ? {} : { checkpointId }),
    ...(staleReasons === undefined ? {} : { staleReasons })
  });
  const persistedReport = reportWithPersistenceScope(report, snapshotContract.snapshotId, freshnessFromRow(freshnessRow));
  const snapshotRowsWritten = await storage.writeReportSnapshot(persistedReport);
  const freshnessRowsWritten = await storage.writeFreshnessRows([freshnessRow]);

  return {
    report: persistedReport,
    snapshotId: snapshotContract.snapshotId,
    freshnessRow,
    snapshotRowsWritten,
    freshnessRowsWritten
  };
}

function isSnapshotStorage(
  storage: FutureErpCanonicalReportReadModelStorage | FutureErpCanonicalReportSnapshotStorage
): storage is FutureErpCanonicalReportSnapshotStorage {
  return "writeReportSnapshot" in storage && "writeFreshnessRows" in storage;
}

function reportWithPersistenceScope(report: BuiltReport, snapshotId: string, freshness: ReportFreshness): BuiltReport {
  return {
    ...report,
    snapshot: {
      ...report.snapshot,
      reportSnapshotId: snapshotId,
      freshness
    },
    lines: report.lines.map((line) => ({
      ...line,
      reportSnapshotId: snapshotId
    })),
    totals: report.totals.map((total) => ({
      ...total,
      reportSnapshotId: snapshotId
    }))
  };
}

function freshnessFromRow(row: ReportFreshnessRow): ReportFreshness {
  return {
    status: row.status,
    sourceId: row.sourceId,
    ...(row.importBatchId === undefined ? {} : { importBatchId: row.importBatchId }),
    ...(row.checkpointId === undefined ? {} : { checkpointId: row.checkpointId }),
    ...(row.freshThrough === undefined ? {} : { freshThrough: row.freshThrough }),
    ...(row.staleReason === undefined ? {} : { staleReason: row.staleReason })
  };
}

function staleReasonsFromFreshness(freshness: ReportFreshness): readonly string[] | undefined {
  if (freshness.status !== "stale") {
    return undefined;
  }
  if (freshness.staleReason === undefined) {
    return ["canonical_report_freshness_marked_stale"];
  }

  return freshness.staleReason.split(";").filter((reason) => reason.length > 0);
}

const PROVIDER_PARITY_REPORT_NAMES: readonly NormalizedQuickBooksProviderReportName[] = [
  "profit_and_loss",
  "balance_sheet",
  "trial_balance",
  "cash_flow"
];

type SupportedProviderReportEnvelope = NormalizedQuickBooksProviderReportResponseEnvelope & {
  readonly supportStatus: "supported";
  readonly providerReportRef: NonNullable<NormalizedQuickBooksProviderReportResponseEnvelope["providerReportRef"]>;
};

export async function fetchFutureErpQuickBooksProviderReportParitySnapshot(
  request: FutureErpQuickBooksProviderReportParityRequest
): Promise<FutureErpQuickBooksProviderReportParitySnapshot> {
  assertFutureErpTenantReadAccess(request.tenantAccess, request.sourceIdentity.tenantId, request.sourceIdentity.sourceId);
  const reports = await Promise.all(PROVIDER_PARITY_REPORT_NAMES.map((reportName) => compareQuickBooksProviderReport(request, reportName)));

  return {
    sourceIdentity: request.sourceIdentity,
    ...(request.comparedAt === undefined ? {} : { comparedAt: request.comparedAt }),
    status: aggregateProviderParityStatus(reports),
    reports
  };
}

async function compareQuickBooksProviderReport(
  parityRequest: FutureErpQuickBooksProviderReportParityRequest,
  reportName: NormalizedQuickBooksProviderReportName
): Promise<FutureErpQuickBooksProviderReportParityResult> {
  const request = providerReportRequest(parityRequest, reportName);
  let providerReport: NormalizedQuickBooksProviderReportResponseEnvelope;

  try {
    providerReport = normalizeProviderReportResponse(request, await requestQuickBooksProviderReport(parityRequest.client, request));
  } catch {
    return {
      reportName,
      status: "unavailable",
      request,
      unavailableReason: "quickbooks_provider_report_unavailable"
    };
  }

  return compareQuickBooksProviderReportResponse(parityRequest, reportName, request, providerReport);
}

function compareQuickBooksProviderReportResponse(
  parityRequest: FutureErpQuickBooksProviderReportParityRequest,
  reportName: NormalizedQuickBooksProviderReportName,
  request: NormalizedQuickBooksProviderReportRequestEnvelope,
  providerReport: NormalizedQuickBooksProviderReportResponseEnvelope
): FutureErpQuickBooksProviderReportParityResult {
  if (providerReport.supportStatus !== "supported" || providerReport.providerReportRef === undefined) {
    const status = providerReport.unsupportedReason === "quickbooks_provider_report_unavailable" ? "unavailable" : "unsupported";
    return {
      reportName,
      status,
      request,
      providerReport,
      ...(providerReport.unsupportedReason === undefined ? {} : { unsupportedReason: providerReport.unsupportedReason }),
      ...(status === "unavailable" ? { unavailableReason: "quickbooks_provider_report_unavailable" as const } : {})
    };
  }

  const canonicalTotals = canonicalTotalsForProviderComparison(parityRequest, reportName);
  if (canonicalTotals.length === 0) {
    return {
      reportName,
      status: "partial",
      request,
      providerReport
    };
  }

  const evidence = buildQuickBooksEvidence(reportName, providerReport as SupportedProviderReportEnvelope, canonicalTotals, parityRequest);
  const hasMissingProviderTotal = evidence.totals.some((total) => total.status === "missing");
  const status = hasMissingProviderTotal ? "partial" : evidence.reconciliationStatus === "balanced" ? "matched" : "mismatched";
  const canonicalDrilldownRefs = canonicalDrilldownRefsForProviderComparison(parityRequest, reportName);

  return {
    reportName,
    status,
    request,
    providerReport,
    providerReportRef: evidence.providerReportRef,
    toleranceAmount: evidence.toleranceAmount ?? "0.00",
    deltas: evidence.totals.map((total): FutureErpQuickBooksProviderReportParityDelta => {
      const canonicalDrilldownRef = canonicalDrilldownRefs.get(total.totalKey);
      const delta = {
        totalKey: total.totalKey,
        status: total.status,
        canonicalAmount: total.canonicalAmount,
        providerAmount: total.providerAmount,
        difference: total.difference,
        absoluteDifference: absoluteMoney(total.difference),
        toleranceAmount: evidence.toleranceAmount ?? "0.00",
        ...(total.drilldownRef === undefined ? {} : { providerDrilldownRef: total.drilldownRef }),
        ...(canonicalDrilldownRef === undefined ? {} : { canonicalDrilldownRef })
      };
      if (delta.providerDrilldownRef !== undefined) {
        assertNoCredentialKeys(delta.providerDrilldownRef);
      }
      if (delta.canonicalDrilldownRef !== undefined) {
        assertNoCredentialKeys(delta.canonicalDrilldownRef.query);
        assertNoCredentialKeys(delta.canonicalDrilldownRef.sourceRefs);
      }
      return delta;
    }),
    evidence,
    reconciliationStatus: evidence.reconciliationStatus,
    reconciliationDifference: evidence.reconciliationDifference,
    reconciliationDifferenceDrilldownRef: providerReconciliationDrilldownRef(
      parityRequest,
      reportName,
      providerReport as SupportedProviderReportEnvelope,
      evidence
    )
  };
}

function providerReportRequest(
  request: FutureErpQuickBooksProviderReportParityRequest,
  reportName: NormalizedQuickBooksProviderReportName
): NormalizedQuickBooksProviderReportRequestEnvelope {
  const base = {
    sourceIdentity: request.sourceIdentity,
    reportName,
    accountingBasis: request.accountingBasis,
    ...(request.currencyCode === undefined ? {} : { currencyCode: request.currencyCode }),
    ...(request.requestedAt === undefined ? {} : { requestedAt: request.requestedAt }),
    idempotencyKey: `${request.sourceIdentity.tenantId}:${request.sourceIdentity.sourceId}:provider-report:${reportName}:${request.periodStart}:${request.periodEnd}`
  };

  if (reportName === "balance_sheet") {
    return {
      ...base,
      reportName,
      asOfDate: request.asOfDate
    };
  }

  return {
    ...base,
    reportName,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd
  };
}

function requestQuickBooksProviderReport(
  client: FutureErpQuickBooksProviderReportParityClient,
  request: NormalizedQuickBooksProviderReportRequestEnvelope
): Promise<NormalizedQuickBooksProviderReportResponseEnvelope> {
  switch (request.reportName) {
    case "profit_and_loss":
      return client.profitAndLossReport({
        ...request,
        reportName: "profit_and_loss",
        periodStart: request.periodStart ?? requiredProviderReportDate("profit_and_loss", "periodStart"),
        periodEnd: request.periodEnd ?? requiredProviderReportDate("profit_and_loss", "periodEnd")
      });
    case "balance_sheet":
      return client.balanceSheetReport({
        ...request,
        reportName: "balance_sheet",
        asOfDate: request.asOfDate ?? requiredProviderReportDate("balance_sheet", "asOfDate")
      });
    case "trial_balance":
      return client.trialBalanceReport({
        ...request,
        reportName: "trial_balance",
        periodStart: request.periodStart ?? requiredProviderReportDate("trial_balance", "periodStart"),
        periodEnd: request.periodEnd ?? requiredProviderReportDate("trial_balance", "periodEnd")
      });
    case "cash_flow":
      return client.cashFlowParityReport({
        ...request,
        reportName: "cash_flow",
        periodStart: request.periodStart ?? requiredProviderReportDate("cash_flow", "periodStart"),
        periodEnd: request.periodEnd ?? requiredProviderReportDate("cash_flow", "periodEnd")
      });
  }
}

function requiredProviderReportDate(reportName: NormalizedQuickBooksProviderReportName, field: "periodStart" | "periodEnd" | "asOfDate"): never {
  throw new Error(`QuickBooks ${reportName} parity request requires ${field}`);
}

function canonicalTotalsForProviderComparison(
  request: FutureErpQuickBooksProviderReportParityRequest,
  reportName: NormalizedQuickBooksProviderReportName
): readonly NormalizedQuickBooksCanonicalReportTotal[] {
  const override = request.canonicalTotalsByReport?.[reportName];
  if (override !== undefined) {
    return override;
  }

  const report = request.reports?.[reportName];
  if (report === undefined) {
    return [];
  }

  return canonicalTotalsFromBuiltReport(reportName, report, request.currencyCode);
}

function canonicalTotalsFromBuiltReport(
  reportName: NormalizedQuickBooksProviderReportName,
  report: BuiltReport,
  currencyCode: IsoCurrencyCode | undefined
): readonly NormalizedQuickBooksCanonicalReportTotal[] {
  const totals = new Map(report.totals.map((total) => [total.totalKey, total.amount]));
  const canonicalTotal = (totalKey: string, amount: DecimalString | undefined): NormalizedQuickBooksCanonicalReportTotal | undefined =>
    amount === undefined
      ? undefined
      : {
          totalKey,
          amount,
          ...(currencyCode === undefined ? {} : { currencyCode })
        };
  const sum = (...totalKeys: readonly string[]): DecimalString | undefined => {
    let found = false;
    let amountMinor = 0n;
    for (const totalKey of totalKeys) {
      const amount = totals.get(totalKey);
      if (amount === undefined) {
        continue;
      }
      found = true;
      amountMinor += parseMoney(amount);
    }

    return found ? formatMoney(amountMinor) : undefined;
  };
  const difference = (leftTotalKey: string, rightTotalKey: string): DecimalString | undefined => {
    const left = totals.get(leftTotalKey);
    const right = totals.get(rightTotalKey);
    if (left === undefined || right === undefined) {
      return undefined;
    }

    return formatMoney(parseMoney(left) - parseMoney(right));
  };

  const mappedTotals =
    reportName === "profit_and_loss"
      ? [
          canonicalTotal("income", totals.get("total_income")),
          canonicalTotal("expenses", sum("total_cost_of_goods_sold", "total_expenses", "total_other_expense")),
          canonicalTotal("net_income", totals.get("net_income"))
        ]
      : reportName === "balance_sheet"
        ? [
            canonicalTotal("assets", totals.get("total_assets")),
            canonicalTotal("liabilities", totals.get("total_liabilities")),
            canonicalTotal("equity", totals.get("total_equity"))
          ]
        : reportName === "trial_balance"
          ? [
              canonicalTotal("debits", totals.get("total_debits")),
              canonicalTotal("credits", totals.get("total_credits")),
              canonicalTotal("net", difference("total_debits", "total_credits"))
            ]
          : [];

  return mappedTotals.filter((total): total is NormalizedQuickBooksCanonicalReportTotal => total !== undefined);
}

function canonicalDrilldownRefsForProviderComparison(
  request: FutureErpQuickBooksProviderReportParityRequest,
  reportName: NormalizedQuickBooksProviderReportName
): ReadonlyMap<string, DrilldownRef> {
  const report = request.reports?.[reportName];
  if (report === undefined) {
    return new Map();
  }

  const totals = new Map(report.totals.map((total) => [total.totalKey, total.drilldownRef]));
  const mappedEntries =
    reportName === "profit_and_loss"
      ? [
          canonicalDrilldownEntry(report, "income", totals.get("total_income")),
          canonicalDrilldownEntry(
            report,
            "expenses",
            combineCanonicalDrilldownRefs(report, "expenses", [
              totals.get("total_cost_of_goods_sold"),
              totals.get("total_expenses"),
              totals.get("total_other_expense")
            ])
          ),
          canonicalDrilldownEntry(report, "net_income", totals.get("net_income"))
        ]
      : reportName === "balance_sheet"
        ? [
            canonicalDrilldownEntry(report, "assets", totals.get("total_assets")),
            canonicalDrilldownEntry(report, "liabilities", totals.get("total_liabilities")),
            canonicalDrilldownEntry(report, "equity", totals.get("total_equity"))
          ]
        : reportName === "trial_balance"
          ? [
              canonicalDrilldownEntry(report, "debits", totals.get("total_debits")),
              canonicalDrilldownEntry(report, "credits", totals.get("total_credits")),
              canonicalDrilldownEntry(report, "net", combineCanonicalDrilldownRefs(report, "net", [totals.get("total_debits"), totals.get("total_credits")]))
            ]
          : [];

  return new Map(mappedEntries.filter((entry): entry is readonly [string, DrilldownRef] => entry !== undefined));
}

function canonicalDrilldownEntry(
  report: BuiltReport,
  totalKey: string,
  drilldownRef: DrilldownRef | undefined
): readonly [string, DrilldownRef] | undefined {
  if (drilldownRef === undefined) {
    return undefined;
  }
  assertNoCredentialKeys(drilldownRef.query);
  return [totalKey, drilldownRef];
}

function combineCanonicalDrilldownRefs(
  report: BuiltReport,
  totalKey: string,
  refs: readonly (DrilldownRef | undefined)[]
): DrilldownRef | undefined {
  const drilldownRefs = refs.filter((ref): ref is DrilldownRef => ref !== undefined);
  if (drilldownRefs.length === 0) {
    return undefined;
  }
  if (drilldownRefs.length === 1) {
    return drilldownRefs[0];
  }

  return createCompactDrilldownRef({
    token: `${report.snapshot.reportName}:${totalKey}:canonical_total`,
    postingIds: uniqueStrings(drilldownRefs.flatMap((ref) => ref.postingIds ?? [])),
    accountIds: uniqueStrings(drilldownRefs.flatMap((ref) => ref.accountIds ?? [])),
    query: {
      kind: "ledger_postings",
      tenantId: report.snapshot.tenantId,
      ...(report.snapshot.freshness.sourceId === undefined ? {} : { sourceId: report.snapshot.freshness.sourceId }),
      accountingBasis: report.snapshot.accountingBasis,
      periodStart: report.snapshot.periodStart,
      periodEnd: report.snapshot.periodEnd
    },
    sourceRefs: drilldownRefs.flatMap((ref) => ref.sourceRefs ?? [])
  });
}

function assertFutureErpTenantReadAccess(
  tenantAccess: FutureErpTenantReadAccess | undefined,
  tenantId: TenantId,
  sourceId: SourceId | undefined
): void {
  if (tenantAccess === undefined) {
    return;
  }
  if (tenantAccess.tenantId !== tenantId) {
    throw new Error(`Future ERP report read denied for tenant ${tenantId}`);
  }
  if (sourceId !== undefined && tenantAccess.sourceIds !== undefined && !tenantAccess.sourceIds.includes(sourceId)) {
    throw new Error(`Future ERP report read denied for source ${sourceId}`);
  }
}

function assertReportInputTenantScope(input: ReportBuilderInput, tenantId: TenantId, sourceId: SourceId): void {
  if (input.tenantId !== tenantId) {
    throw new Error(`Future ERP report input tenant ${input.tenantId} does not match request ${tenantId}`);
  }
  for (const account of input.accounts) {
    if (account.tenantId !== tenantId || account.sourceId !== sourceId) {
      throw new Error("Future ERP report input includes an account outside the requested tenant/source scope");
    }
  }
  for (const posting of input.postings) {
    if (posting.tenantId !== tenantId || posting.sourceId !== sourceId) {
      throw new Error("Future ERP report input includes a posting outside the requested tenant/source scope");
    }
  }
}

function assertReportTenantScope(report: BuiltReport, tenantId: TenantId, surface: string): void {
  if (report.snapshot.tenantId !== tenantId) {
    throw new Error(`Future ERP ${surface} tenant ${report.snapshot.tenantId} does not match request ${tenantId}`);
  }
  for (const line of report.lines) {
    if (line.tenantId !== tenantId) {
      throw new Error(`Future ERP ${surface} line ${line.reportLineId} is outside tenant ${tenantId}`);
    }
  }
  for (const total of report.totals) {
    if (total.tenantId !== tenantId) {
      throw new Error(`Future ERP ${surface} total ${total.reportTotalId} is outside tenant ${tenantId}`);
    }
  }
}

function buildFutureErpReportDrilldownSurface(report: BuiltReport): FutureErpReportDrilldownSurface {
  const reportSnapshotRef = canonicalReportSnapshotSourceRef(report);
  const reconciliationDifference = reportReconciliationDifferenceDrilldown(report, reportSnapshotRef);
  const surface = {
    tenantId: report.snapshot.tenantId,
    reportSnapshotId: report.snapshot.reportSnapshotId,
    reportSnapshotRef,
    lines: report.lines.map((line): FutureErpReportDrilldownSurfaceEntry => ({
      id: line.reportLineId,
      label: line.label,
      amount: line.amount,
      drilldownRef: line.drilldownRef
    })),
    totals: report.totals.map((total): FutureErpReportDrilldownSurfaceEntry => ({
      id: total.reportTotalId,
      label: total.label,
      amount: total.amount,
      drilldownRef: total.drilldownRef
    })),
    reconciliationDifference
  };
  assertNoCredentialKeys(surface.reportSnapshotRef);
  assertNoCredentialKeys(surface.reconciliationDifference.drilldownRef.query);
  return surface;
}

function canonicalReportSnapshotSourceRef(report: BuiltReport): SafeSourcePayloadRef {
  const sourceRef = {
    sourceObjectType: "CanonicalReportSnapshot",
    sourceObjectId: report.snapshot.reportSnapshotId,
    sourceUpdatedAt: report.snapshot.generatedAt,
    preview: {
      reportName: report.snapshot.reportName,
      accountingBasis: report.snapshot.accountingBasis,
      periodStart: report.snapshot.periodStart,
      periodEnd: report.snapshot.periodEnd,
      asOfDate: report.snapshot.asOfDate,
      currencyCode: report.snapshot.currencyCode
    }
  } satisfies SafeSourcePayloadRef;
  assertSafeSourcePayloadRef(sourceRef);
  return sourceRef;
}

function reportReconciliationDifferenceDrilldown(
  report: BuiltReport,
  reportSnapshotRef: SafeSourcePayloadRef
): FutureErpReportReconciliationDrilldownSurface {
  const sourceRefs = [
    reportSnapshotRef,
    ...report.lines.flatMap((line) => line.drilldownRef.sourceRefs ?? []),
    ...report.totals.flatMap((total) => total.drilldownRef.sourceRefs ?? [])
  ];

  return {
    status: report.snapshot.reconciliationStatus,
    difference: report.snapshot.reconciliationDifference,
    drilldownRef: createCompactDrilldownRef({
      token: `${report.snapshot.reportName}:reconciliation_difference`,
      postingIds: uniqueStrings([
        ...report.lines.flatMap((line) => line.drilldownRef.postingIds ?? []),
        ...report.totals.flatMap((total) => total.drilldownRef.postingIds ?? [])
      ]),
      accountIds: uniqueStrings([
        ...report.lines.flatMap((line) => line.drilldownRef.accountIds ?? []),
        ...report.totals.flatMap((total) => total.drilldownRef.accountIds ?? [])
      ]),
      query: {
        kind: "ledger_postings",
        tenantId: report.snapshot.tenantId,
        accountingBasis: report.snapshot.accountingBasis,
        periodStart: report.snapshot.periodStart,
        periodEnd: report.snapshot.periodEnd
      },
      sourceRefs
    })
  };
}

function providerReconciliationDrilldownRef(
  request: FutureErpQuickBooksProviderReportParityRequest,
  reportName: NormalizedQuickBooksProviderReportName,
  providerReport: SupportedProviderReportEnvelope,
  evidence: NormalizedAccountingReconciliationEvidence
): DrilldownRef {
  const report = request.reports?.[reportName];
  const canonicalRefs =
    report === undefined
      ? []
      : [
          ...report.lines.flatMap((line) => line.drilldownRef.sourceRefs ?? []),
          ...report.totals.flatMap((total) => total.drilldownRef.sourceRefs ?? [])
        ];

  return createCompactDrilldownRef({
    token: `${reportName}:quickbooks_reconciliation_difference`,
    postingIds:
      report === undefined
        ? []
        : uniqueStrings([
            ...report.lines.flatMap((line) => line.drilldownRef.postingIds ?? []),
            ...report.totals.flatMap((total) => total.drilldownRef.postingIds ?? [])
          ]),
    accountIds:
      report === undefined
        ? []
        : uniqueStrings([
            ...report.lines.flatMap((line) => line.drilldownRef.accountIds ?? []),
            ...report.totals.flatMap((total) => total.drilldownRef.accountIds ?? [])
          ]),
    query: {
      kind: "ledger_postings",
      tenantId: request.sourceIdentity.tenantId,
      sourceId: request.sourceIdentity.sourceId,
      accountingBasis: request.accountingBasis,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd
    },
    sourceRefs: [
      providerReport.providerReportRef.sourcePayloadRef,
      evidence.providerReportRef.sourcePayloadRef,
      ...evidence.totals.flatMap((total) => (total.drilldownRef === undefined ? [] : [total.drilldownRef])),
      ...canonicalRefs
    ]
  });
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function normalizeProviderReportResponse(
  request: NormalizedQuickBooksProviderReportRequestEnvelope,
  response: NormalizedQuickBooksProviderReportResponseEnvelope
): NormalizedQuickBooksProviderReportResponseEnvelope {
  if (response.supportStatus === "supported" && response.providerReportRef !== undefined) {
    return buildNormalizedQuickBooksProviderReportResponse(request, {
      providerReportRef: response.providerReportRef,
      ...(response.importBatchId === undefined ? {} : { importBatchId: response.importBatchId }),
      ...(response.checkpointId === undefined ? {} : { checkpointId: response.checkpointId }),
      ...(response.sourceFreshThrough === undefined ? {} : { sourceFreshThrough: response.sourceFreshThrough }),
      ...(response.importedThrough === undefined ? {} : { importedThrough: response.importedThrough }),
      ...(response.latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt: response.latestSourceUpdatedAt }),
      ...(response.generatedAt === undefined ? {} : { generatedAt: response.generatedAt }),
      ...(response.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: response.sourceUpdatedAt }),
      totals: response.totals
    });
  }

  const importBatchId = response.importBatchId ?? request.importBatchId;
  const checkpointId = response.checkpointId ?? request.checkpointId;
  const sourceFreshThrough = response.sourceFreshThrough ?? request.sourceFreshThrough;
  const importedThrough = response.importedThrough ?? request.importedThrough;
  const latestSourceUpdatedAt = response.latestSourceUpdatedAt ?? request.latestSourceUpdatedAt;

  return {
    sourceIdentity: request.sourceIdentity,
    providerEnvironment: request.sourceIdentity.providerEnvironment,
    reportName: request.reportName,
    supportStatus: "unsupported",
    unsupportedReason: response.unsupportedReason ?? "quickbooks_provider_report_unavailable",
    accountingBasis: request.accountingBasis,
    ...(request.currencyCode === undefined ? {} : { currencyCode: request.currencyCode }),
    ...(importBatchId === undefined ? {} : { importBatchId }),
    ...(checkpointId === undefined ? {} : { checkpointId }),
    ...(sourceFreshThrough === undefined ? {} : { sourceFreshThrough }),
    ...(importedThrough === undefined ? {} : { importedThrough }),
    ...(latestSourceUpdatedAt === undefined ? {} : { latestSourceUpdatedAt }),
    ...(request.periodStart === undefined ? {} : { periodStart: request.periodStart }),
    ...(request.periodEnd === undefined ? {} : { periodEnd: request.periodEnd }),
    ...(request.asOfDate === undefined ? {} : { asOfDate: request.asOfDate }),
    ...(request.requestedAt === undefined ? {} : { requestedAt: request.requestedAt }),
    ...(response.generatedAt === undefined ? {} : { generatedAt: response.generatedAt }),
    ...(response.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: response.sourceUpdatedAt }),
    totals: []
  };
}

function parseMoney(amount: DecimalString): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (match === null) {
    throw new Error(`Invalid decimal money amount: ${amount}`);
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const dollars = BigInt(match[2] ?? "0");
  const cents = BigInt((match[3] ?? "").padEnd(2, "0"));
  return sign * (dollars * 100n + cents);
}

function formatMoney(amountMinor: bigint): DecimalString {
  const sign = amountMinor < 0n ? "-" : "";
  const absolute = amountMinor < 0n ? -amountMinor : amountMinor;
  const dollars = absolute / 100n;
  const cents = absolute % 100n;

  return `${sign}${dollars.toString()}.${cents.toString().padStart(2, "0")}`;
}

function absoluteMoney(amount: DecimalString): DecimalString {
  const amountMinor = parseMoney(amount);
  return formatMoney(amountMinor < 0n ? -amountMinor : amountMinor);
}

function buildQuickBooksEvidence(
  reportName: NormalizedQuickBooksProviderReportName,
  providerReport: SupportedProviderReportEnvelope,
  canonicalTotals: readonly NormalizedQuickBooksCanonicalReportTotal[],
  request: FutureErpQuickBooksProviderReportParityRequest
): NormalizedAccountingReconciliationEvidence {
  const input = {
    providerReport,
    canonicalTotals,
    ...(request.toleranceAmount === undefined ? {} : { toleranceAmount: request.toleranceAmount }),
    ...(request.comparedAt === undefined ? {} : { generatedAt: request.comparedAt })
  };

  switch (reportName) {
    case "profit_and_loss":
      return buildQuickBooksProfitAndLossReconciliationEvidence({
        ...input,
        providerReport: { ...providerReport, reportName: "profit_and_loss" }
      });
    case "balance_sheet":
      return buildQuickBooksBalanceSheetReconciliationEvidence({
        ...input,
        providerReport: { ...providerReport, reportName: "balance_sheet" }
      });
    case "trial_balance":
      return buildQuickBooksTrialBalanceReconciliationEvidence({
        ...input,
        providerReport: { ...providerReport, reportName: "trial_balance" }
      });
    case "cash_flow":
      return buildQuickBooksProviderReportReconciliationEvidence(input);
  }
}

function aggregateProviderParityStatus(
  reports: readonly FutureErpQuickBooksProviderReportParityResult[]
): FutureErpQuickBooksProviderReportParityStatus {
  if (reports.some((report) => report.status === "unavailable")) {
    return "unavailable";
  }
  if (reports.some((report) => report.status === "mismatched")) {
    return "mismatched";
  }
  if (reports.some((report) => report.status === "partial")) {
    return "partial";
  }
  if (reports.some((report) => report.status === "unsupported")) {
    return "unsupported";
  }
  return "matched";
}
