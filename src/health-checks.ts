import { createHash } from "node:crypto";

import {
  DEFAULT_DRILLDOWN_INLINE_POSTING_LIMIT,
  DEFAULT_DRILLDOWN_INLINE_SOURCE_REF_LIMIT,
  DEFAULT_JSON_REF_MAX_BYTES,
  assertNoCredentialKeys,
  assertSafeDrilldownRef
} from "./canonical-model.js";
import { ERP_FINANCIALS_STATEMENT_FIXTURE } from "./fixtures.js";
import { createSnapshotRefreshContract } from "./rollup-jobs.js";
import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "./report-builders.js";

import type {
  AccountingBasis,
  DrilldownRef,
  IsoCurrencyCode,
  IsoDate,
  SourceId,
  TenantId
} from "./canonical-model.js";
import type { StatementFixtureSet } from "./fixtures.js";
import type { ReportFreshnessRow } from "./postgres-storage.js";
import type { BuiltReport, ReportBuilderInput, ReportName } from "./report-builders.js";

export type ErpFinancialsFreshnessDrilldownHealthStatus = "healthy" | "degraded";
export type ErpFinancialsFreshnessDrilldownHealthCheckStatus = "pass" | "fail";

export type ErpFinancialsHealthIssueKind =
  | "missing_freshness_row"
  | "unsafe_drilldown_ref"
  | "unscoped_drilldown_ref"
  | "unresolvable_drilldown_ref"
  | "unbounded_drilldown_ref"
  | "output_boundary_failed";

export type ErpFinancialsHealthFreshnessCombination = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly reportName: ReportName;
  readonly accountingBasis: AccountingBasis;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly currencyCode: IsoCurrencyCode;
};

export type ErpFinancialsHealthIssue = {
  readonly kind: ErpFinancialsHealthIssueKind;
  readonly reportName?: ReportName;
  readonly refKind?: "line" | "total";
  readonly refId?: string;
  readonly combination?: ErpFinancialsHealthFreshnessCombination;
  readonly message: string;
};

export type ErpFinancialsFreshnessHealthSummary = {
  readonly expectedRows: number;
  readonly presentRows: number;
  readonly missingRows: readonly ErpFinancialsHealthFreshnessCombination[];
  readonly checkedReportNames: readonly ReportName[];
};

export type ErpFinancialsDrilldownHealthSample = {
  readonly reportName: ReportName;
  readonly refKind: "line" | "total";
  readonly refId: string;
  readonly refToken: string;
  readonly postingCount: number;
  readonly inlinePostingCount: number;
  readonly sourceRefCount: number;
  readonly inlineSourceRefCount: number;
  readonly serializedBytes: number;
  readonly resolution: "canonical_query" | "posting_evidence";
};

export type ErpFinancialsDrilldownHealthSummary = {
  readonly reportsChecked: number;
  readonly refsChecked: number;
  readonly lineRefsChecked: number;
  readonly totalRefsChecked: number;
  readonly compactedPostingRefCount: number;
  readonly compactedSourceRefCount: number;
  readonly maxSerializedBytes: number;
  readonly maxInlinePostingIds: number;
  readonly maxInlineSourceRefs: number;
  readonly sampleRefs: readonly ErpFinancialsDrilldownHealthSample[];
};

export type ErpFinancialsFreshnessDrilldownHealthCheck = {
  readonly name: "freshness_rows" | "drilldown_refs";
  readonly status: ErpFinancialsFreshnessDrilldownHealthCheckStatus;
  readonly issueCount: number;
};

export type ErpFinancialsFreshnessDrilldownHealthResult = {
  readonly status: ErpFinancialsFreshnessDrilldownHealthStatus;
  readonly fixtureName: "ERP_FINANCIALS_STATEMENT_FIXTURE";
  readonly tenantId: TenantId;
  readonly sourceId: SourceId;
  readonly accountingBasis: AccountingBasis;
  readonly currencyCode: IsoCurrencyCode;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly checks: readonly ErpFinancialsFreshnessDrilldownHealthCheck[];
  readonly freshness: ErpFinancialsFreshnessHealthSummary;
  readonly drilldown: ErpFinancialsDrilldownHealthSummary;
  readonly issues: readonly ErpFinancialsHealthIssue[];
  readonly summaryHash: string;
};

export type ErpFinancialsFreshnessDrilldownHealthOptions = {
  readonly fixture?: StatementFixtureSet;
  readonly freshnessRows?: readonly ReportFreshnessRow[];
  readonly freshnessCombinations?: readonly ErpFinancialsHealthFreshnessCombination[];
  readonly reports?: readonly BuiltReport[];
  readonly expectedTenantId?: TenantId;
  readonly expectedSourceId?: SourceId;
  readonly maxJsonBytes?: number;
  readonly maxInlinePostingIds?: number;
  readonly maxInlineSourceRefs?: number;
  readonly sampleLimit?: number;
};

const SUPPORTED_REPORT_NAMES = ["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"] as const;
const DEFAULT_SAMPLE_LIMIT = 8;

export function checkErpFinancialsFreshnessAndDrilldownHealth(
  options: ErpFinancialsFreshnessDrilldownHealthOptions = {}
): ErpFinancialsFreshnessDrilldownHealthResult {
  const fixture = options.fixture ?? ERP_FINANCIALS_STATEMENT_FIXTURE;
  const reports = options.reports ?? buildFixtureReports(fixture);
  const freshnessCombinations = options.freshnessCombinations ?? fixtureFreshnessCombinations(fixture);
  const freshnessRows = options.freshnessRows ?? fixtureFreshnessRows(fixture);
  const issues: ErpFinancialsHealthIssue[] = [];
  const freshness = checkFreshnessRows(freshnessCombinations, freshnessRows, issues);
  const drilldown = checkDrilldownRefs({
    reports,
    expectedTenantId: options.expectedTenantId ?? fixture.reportRequest.tenantId,
    expectedSourceId: options.expectedSourceId ?? fixture.source.sourceId,
    maxJsonBytes: options.maxJsonBytes ?? DEFAULT_JSON_REF_MAX_BYTES,
    maxInlinePostingIds: options.maxInlinePostingIds ?? DEFAULT_DRILLDOWN_INLINE_POSTING_LIMIT,
    maxInlineSourceRefs: options.maxInlineSourceRefs ?? DEFAULT_DRILLDOWN_INLINE_SOURCE_REF_LIMIT,
    sampleLimit: options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT,
    issues
  });
  const freshnessIssueCount = issues.filter((issue) => issue.kind === "missing_freshness_row").length;
  const drilldownIssueCount = issues.length - freshnessIssueCount;
  const resultWithoutHash: Omit<ErpFinancialsFreshnessDrilldownHealthResult, "summaryHash"> = {
    status: issues.length === 0 ? "healthy" : "degraded",
    fixtureName: "ERP_FINANCIALS_STATEMENT_FIXTURE" as const,
    tenantId: fixture.reportRequest.tenantId,
    sourceId: fixture.source.sourceId,
    accountingBasis: fixture.reportRequest.accountingBasis,
    currencyCode: fixture.reportRequest.currencyCode,
    periodStart: fixture.reportRequest.periodStart,
    periodEnd: fixture.reportRequest.periodEnd,
    checks: [
      {
        name: "freshness_rows" as const,
        status: freshnessIssueCount === 0 ? "pass" as const : "fail" as const,
        issueCount: freshnessIssueCount
      },
      {
        name: "drilldown_refs" as const,
        status: drilldownIssueCount === 0 ? "pass" as const : "fail" as const,
        issueCount: drilldownIssueCount
      }
    ],
    freshness,
    drilldown,
    issues
  };
  const result: ErpFinancialsFreshnessDrilldownHealthResult = {
    ...resultWithoutHash,
    summaryHash: stableHash({
      status: resultWithoutHash.status,
      tenantId: resultWithoutHash.tenantId,
      sourceId: resultWithoutHash.sourceId,
      accountingBasis: resultWithoutHash.accountingBasis,
      currencyCode: resultWithoutHash.currencyCode,
      periodStart: resultWithoutHash.periodStart,
      periodEnd: resultWithoutHash.periodEnd,
      checks: resultWithoutHash.checks,
      freshness,
      drilldown: {
        reportsChecked: drilldown.reportsChecked,
        refsChecked: drilldown.refsChecked,
        lineRefsChecked: drilldown.lineRefsChecked,
        totalRefsChecked: drilldown.totalRefsChecked,
        compactedPostingRefCount: drilldown.compactedPostingRefCount,
        compactedSourceRefCount: drilldown.compactedSourceRefCount,
        maxSerializedBytes: drilldown.maxSerializedBytes,
        maxInlinePostingIds: drilldown.maxInlinePostingIds,
        maxInlineSourceRefs: drilldown.maxInlineSourceRefs
      },
      issueKinds: issues.map((issue) => issue.kind)
    })
  };

  try {
    assertNoCredentialKeys(result);
  } catch {
    return {
      ...result,
      status: "degraded",
      checks: result.checks.map((check) =>
        check.name === "drilldown_refs" ? { ...check, status: "fail", issueCount: check.issueCount + 1 } : check
      ),
      issues: [
        ...result.issues,
        {
          kind: "output_boundary_failed",
          message: "freshness and drilldown health output contains a prohibited field name"
        }
      ]
    };
  }

  return result;
}

function checkFreshnessRows(
  combinations: readonly ErpFinancialsHealthFreshnessCombination[],
  rows: readonly ReportFreshnessRow[],
  issues: ErpFinancialsHealthIssue[]
): ErpFinancialsFreshnessHealthSummary {
  const rowKeys = new Set(rows.map(freshnessKey));
  const missingRows = combinations.filter((combination) => !rowKeys.has(freshnessKey(combination)));

  for (const combination of missingRows) {
    issues.push({
      kind: "missing_freshness_row",
      reportName: combination.reportName,
      combination,
      message: `missing freshness row for ${combination.reportName} ${combination.accountingBasis} ${combination.periodStart}..${combination.periodEnd} ${combination.currencyCode}`
    });
  }

  return {
    expectedRows: combinations.length,
    presentRows: combinations.length - missingRows.length,
    missingRows,
    checkedReportNames: sortedReportNames(combinations.map((combination) => combination.reportName))
  };
}

function checkDrilldownRefs(input: {
  readonly reports: readonly BuiltReport[];
  readonly expectedTenantId: TenantId;
  readonly expectedSourceId: SourceId;
  readonly maxJsonBytes: number;
  readonly maxInlinePostingIds: number;
  readonly maxInlineSourceRefs: number;
  readonly sampleLimit: number;
  readonly issues: ErpFinancialsHealthIssue[];
}): ErpFinancialsDrilldownHealthSummary {
  const samples: ErpFinancialsDrilldownHealthSample[] = [];
  let refsChecked = 0;
  let lineRefsChecked = 0;
  let totalRefsChecked = 0;
  let compactedPostingRefCount = 0;
  let compactedSourceRefCount = 0;
  let maxSerializedBytes = 0;
  let maxInlinePostingIds = 0;
  let maxInlineSourceRefs = 0;

  for (const report of input.reports) {
    for (const line of report.lines) {
      refsChecked += 1;
      lineRefsChecked += 1;
      const audit = auditDrilldownRef({
        reportName: report.snapshot.reportName as ReportName,
        refKind: "line",
        refId: line.reportLineId,
        ref: line.drilldownRef,
        expectedTenantId: input.expectedTenantId,
        expectedSourceId: input.expectedSourceId,
        maxJsonBytes: input.maxJsonBytes,
        maxInlinePostingIds: input.maxInlinePostingIds,
        maxInlineSourceRefs: input.maxInlineSourceRefs,
        issues: input.issues
      });
      maxSerializedBytes = Math.max(maxSerializedBytes, audit.serializedBytes);
      maxInlinePostingIds = Math.max(maxInlinePostingIds, audit.inlinePostingCount);
      maxInlineSourceRefs = Math.max(maxInlineSourceRefs, audit.inlineSourceRefCount);
      compactedPostingRefCount += audit.compactedPostingRefCount;
      compactedSourceRefCount += audit.compactedSourceRefCount;
      if (samples.length < input.sampleLimit) {
        samples.push(audit.sample);
      }
    }

    for (const total of report.totals) {
      refsChecked += 1;
      totalRefsChecked += 1;
      const audit = auditDrilldownRef({
        reportName: report.snapshot.reportName as ReportName,
        refKind: "total",
        refId: total.reportTotalId,
        ref: total.drilldownRef,
        expectedTenantId: input.expectedTenantId,
        expectedSourceId: input.expectedSourceId,
        maxJsonBytes: input.maxJsonBytes,
        maxInlinePostingIds: input.maxInlinePostingIds,
        maxInlineSourceRefs: input.maxInlineSourceRefs,
        issues: input.issues
      });
      maxSerializedBytes = Math.max(maxSerializedBytes, audit.serializedBytes);
      maxInlinePostingIds = Math.max(maxInlinePostingIds, audit.inlinePostingCount);
      maxInlineSourceRefs = Math.max(maxInlineSourceRefs, audit.inlineSourceRefCount);
      compactedPostingRefCount += audit.compactedPostingRefCount;
      compactedSourceRefCount += audit.compactedSourceRefCount;
      if (samples.length < input.sampleLimit) {
        samples.push(audit.sample);
      }
    }
  }

  return {
    reportsChecked: input.reports.length,
    refsChecked,
    lineRefsChecked,
    totalRefsChecked,
    compactedPostingRefCount,
    compactedSourceRefCount,
    maxSerializedBytes,
    maxInlinePostingIds,
    maxInlineSourceRefs,
    sampleRefs: samples
  };
}

function auditDrilldownRef(input: {
  readonly reportName: ReportName;
  readonly refKind: "line" | "total";
  readonly refId: string;
  readonly ref: DrilldownRef;
  readonly expectedTenantId: TenantId;
  readonly expectedSourceId: SourceId;
  readonly maxJsonBytes: number;
  readonly maxInlinePostingIds: number;
  readonly maxInlineSourceRefs: number;
  readonly issues: ErpFinancialsHealthIssue[];
}): {
  readonly serializedBytes: number;
  readonly inlinePostingCount: number;
  readonly inlineSourceRefCount: number;
  readonly compactedPostingRefCount: number;
  readonly compactedSourceRefCount: number;
  readonly sample: ErpFinancialsDrilldownHealthSample;
} {
  try {
    assertSafeDrilldownRef(input.ref);
  } catch {
    pushDrilldownIssue(input, "unsafe_drilldown_ref", "drilldown ref failed safe source/query validation");
  }

  const serializedBytes = Buffer.byteLength(stableJson(input.ref), "utf8");
  const inlinePostingCount = input.ref.postingIds?.length ?? 0;
  const postingCount = input.ref.postingCount ?? inlinePostingCount;
  const inlineSourceRefCount = input.ref.sourceRefs?.length ?? 0;
  const sourceRefCount = input.ref.sourceRefCount ?? inlineSourceRefCount;
  const hasCanonicalQuery =
    input.ref.query?.kind === "ledger_postings" &&
    input.ref.query.tenantId === input.expectedTenantId &&
    input.ref.query.sourceId === input.expectedSourceId;
  const hasPostingEvidence = inlinePostingCount > 0 || inlineSourceRefCount > 0;

  if (serializedBytes > input.maxJsonBytes || inlinePostingCount > input.maxInlinePostingIds || inlineSourceRefCount > input.maxInlineSourceRefs) {
    pushDrilldownIssue(input, "unbounded_drilldown_ref", "drilldown ref exceeds bounded inline or serialized limits");
  }
  if (!hasCanonicalQuery && input.ref.query !== undefined) {
    pushDrilldownIssue(input, "unscoped_drilldown_ref", "drilldown query is not scoped to the expected tenant and source");
  }
  if (!hasCanonicalQuery && !hasPostingEvidence) {
    pushDrilldownIssue(input, "unresolvable_drilldown_ref", "drilldown ref lacks a tenant-scoped canonical query or posting evidence");
  }

  const resolution = hasCanonicalQuery ? "canonical_query" : "posting_evidence";

  return {
    serializedBytes,
    inlinePostingCount,
    inlineSourceRefCount,
    compactedPostingRefCount: postingCount > input.maxInlinePostingIds && input.ref.postingIds === undefined ? 1 : 0,
    compactedSourceRefCount: sourceRefCount > input.maxInlineSourceRefs && input.ref.sourceRefs === undefined ? 1 : 0,
    sample: {
      reportName: input.reportName,
      refKind: input.refKind,
      refId: safeId(input.refId),
      refToken: safeId(input.ref.token),
      postingCount,
      inlinePostingCount,
      sourceRefCount,
      inlineSourceRefCount,
      serializedBytes,
      resolution
    }
  };
}

function pushDrilldownIssue(
  input: {
    readonly reportName: ReportName;
    readonly refKind: "line" | "total";
    readonly refId: string;
    readonly issues: ErpFinancialsHealthIssue[];
  },
  kind: Exclude<ErpFinancialsHealthIssueKind, "missing_freshness_row" | "output_boundary_failed">,
  message: string
): void {
  input.issues.push({
    kind,
    reportName: input.reportName,
    refKind: input.refKind,
    refId: safeId(input.refId),
    message
  });
}

function fixtureFreshnessCombinations(fixture: StatementFixtureSet): readonly ErpFinancialsHealthFreshnessCombination[] {
  return SUPPORTED_REPORT_NAMES.map((reportName) => ({
    tenantId: fixture.reportRequest.tenantId,
    companyId: fixture.company.companyId,
    sourceId: fixture.source.sourceId,
    reportName,
    accountingBasis: fixture.reportRequest.accountingBasis,
    periodStart: fixture.reportRequest.periodStart,
    periodEnd: fixture.reportRequest.periodEnd,
    currencyCode: fixture.reportRequest.currencyCode
  }));
}

function fixtureFreshnessRows(fixture: StatementFixtureSet): readonly ReportFreshnessRow[] {
  return SUPPORTED_REPORT_NAMES.map((reportName) => createFixtureSnapshotContract(fixture, reportName).freshnessRow);
}

function createFixtureSnapshotContract(fixture: StatementFixtureSet, reportName: ReportName) {
  return createSnapshotRefreshContract({
    tenantId: fixture.reportRequest.tenantId,
    companyId: fixture.company.companyId,
    sourceId: fixture.source.sourceId,
    reportName,
    accountingBasis: fixture.reportRequest.accountingBasis,
    periodStart: fixture.reportRequest.periodStart,
    periodEnd: fixture.reportRequest.periodEnd,
    asOfDate: fixture.reportRequest.asOfDate,
    currencyCode: fixture.reportRequest.currencyCode,
    generatedAt: fixture.reportRequest.generatedAt,
    ...(fixture.checkpoint.freshThrough === undefined ? {} : { freshThrough: fixture.checkpoint.freshThrough }),
    importBatchId: fixture.importBatch.importBatchId,
    checkpointId: fixture.checkpoint.checkpointId
  });
}

function buildFixtureReports(fixture: StatementFixtureSet): readonly BuiltReport[] {
  return SUPPORTED_REPORT_NAMES.map((reportName) => {
    const freshness = freshnessFromRow(createFixtureSnapshotContract(fixture, reportName).freshnessRow);
    const input: ReportBuilderInput = {
      ...fixture.reportRequest,
      accounts: fixture.accounts,
      postings: fixture.postings,
      sourceId: fixture.source.sourceId,
      freshness
    };

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
          cashAccountIds: fixture.cashFlow.cashAccountIds,
          activityByAccountId: fixture.cashFlow.activityByAccountId
        });
    }
  });
}

function freshnessFromRow(row: ReportFreshnessRow) {
  return {
    status: row.status,
    sourceId: row.sourceId,
    ...(row.importBatchId === undefined ? {} : { importBatchId: row.importBatchId }),
    ...(row.checkpointId === undefined ? {} : { checkpointId: row.checkpointId }),
    ...(row.freshThrough === undefined ? {} : { freshThrough: row.freshThrough }),
    ...(row.staleReason === undefined ? {} : { staleReason: row.staleReason })
  };
}

function freshnessKey(input: ErpFinancialsHealthFreshnessCombination | ReportFreshnessRow): string {
  return [
    input.tenantId,
    input.companyId,
    input.sourceId,
    input.reportName,
    input.accountingBasis,
    input.periodStart,
    input.periodEnd,
    input.currencyCode
  ].join(":");
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160);
}

function sortedReportNames(values: readonly ReportName[]): readonly ReportName[] {
  return [...new Set(values)].sort();
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
