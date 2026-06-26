import { buildFutureErpReportFromCanonicalReadModel } from "./future-erp-reporting.js";
import type { ReportFreshness } from "./canonical-model.js";
import type {
  FutureErpCanonicalReportGenerationRequest,
  FutureErpCanonicalReportGenerationResult,
  FutureErpCanonicalReportReadModelStorage,
  FutureErpCanonicalReportSnapshotStorage,
  FutureErpReportDrilldownSurface,
  FutureErpReportDrilldownSurfaceEntry,
  FutureErpReportReconciliationDrilldownSurface,
  FutureErpTenantReadAccess
} from "./future-erp-reporting.js";
import type { ReportFreshnessRow, RollupBucket } from "./postgres-storage.js";
import type { BuiltReport, ReportName } from "./report-builders.js";

export const CORE_ERP_CANONICAL_REPORT_NAMES = [
  "profit_and_loss",
  "balance_sheet",
  "trial_balance",
  "cash_flow"
] as const satisfies readonly ReportName[];

export type CoreErpReportName = ReportName;
export type CoreErpReport = BuiltReport;
export type CoreErpReportFreshness = ReportFreshness;
export type CoreErpReportFreshnessRow = ReportFreshnessRow;
export type CoreErpReportRollupBucket = RollupBucket;
export type CoreErpTenantReadAccess = FutureErpTenantReadAccess;
export type CoreErpCanonicalReportReadModelStorage = FutureErpCanonicalReportReadModelStorage;
export type CoreErpCanonicalReportSnapshotStorage = FutureErpCanonicalReportSnapshotStorage;
export type CoreErpCanonicalReportGenerationRequest = FutureErpCanonicalReportGenerationRequest;
export type CoreErpCanonicalReportGenerationResult = FutureErpCanonicalReportGenerationResult;
export type CoreErpReportDrilldownSurfaceEntry = FutureErpReportDrilldownSurfaceEntry;
export type CoreErpReportReconciliationDrilldownSurface = FutureErpReportReconciliationDrilldownSurface;
export type CoreErpReportDrilldownSurface = FutureErpReportDrilldownSurface;

export function buildCoreErpReportFromCanonicalReadModel(
  storage: CoreErpCanonicalReportReadModelStorage | CoreErpCanonicalReportSnapshotStorage,
  request: CoreErpCanonicalReportGenerationRequest
): Promise<CoreErpCanonicalReportGenerationResult> {
  return buildFutureErpReportFromCanonicalReadModel(storage, request);
}
