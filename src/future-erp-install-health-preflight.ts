import {
  checkErpFinancialsInstallHealth,
  type ErpFinancialsInstallHealthIssue,
  type ErpFinancialsInstallHealthResult
} from "./install-health.js";
import {
  runErpFinancialsFixtureSmokeHealth,
  type ErpFinancialsFixtureSmokeHealthOptions,
  type ErpFinancialsFixtureSmokeHealthResult
} from "./fixture-smoke-health.js";

import type { PostgresQueryClient } from "./postgres-storage.js";
import type { PostgresSchemaManifest } from "./schema-manifest.js";

export type FutureErpInstallHealthPreflightEnvironment = "dev" | "test" | "staging" | "production";
export type FutureErpInstallHealthPreflightStatus = "healthy" | "degraded" | "blocked";
export type FutureErpInstallHealthPreflightCheckStatus = "pass" | "warn" | "fail" | "skipped";
export type FutureErpInstallHealthPreflightIssueSeverity = "warning" | "blocker";

export type FutureErpInstallHealthPreflightCheckName =
  | "dev_test_only_execution"
  | "erp_financials_install_schema"
  | "erp_financials_fixture_support"
  | "erp_financials_sensitive_column_boundary"
  | "erp_financials_fixture_smoke";

export type FutureErpInstallHealthPreflightIssueKind =
  | "environment_not_allowed"
  | "postgres_client_missing"
  | "schema_incompatible"
  | "fixture_support_missing"
  | "sensitive_column_boundary_failed"
  | "fixture_smoke_degraded";

export type FutureErpInstallHealthPreflightCheck = {
  readonly name: FutureErpInstallHealthPreflightCheckName;
  readonly status: FutureErpInstallHealthPreflightCheckStatus;
  readonly issueCount: number;
  readonly message?: string;
};

export type FutureErpInstallHealthPreflightIssue = {
  readonly kind: FutureErpInstallHealthPreflightIssueKind;
  readonly severity: FutureErpInstallHealthPreflightIssueSeverity;
  readonly checkName: FutureErpInstallHealthPreflightCheckName;
  readonly message: string;
};

export type FutureErpInstallHealthPreflightInstallSummary = {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly manifestVersion: string;
  readonly schemaVersion: number;
  readonly namespace: string;
  readonly dialect: string;
  readonly compatible: boolean;
  readonly fixtureSupport: boolean;
  readonly sensitiveColumnBoundary: "pass" | "fail";
  readonly issueCounts: {
    readonly schema: number;
    readonly fixtureSupport: number;
    readonly sensitiveColumnBoundary: number;
  };
};

export type FutureErpInstallHealthPreflightFixtureSmokeSummary = {
  readonly status: ErpFinancialsFixtureSmokeHealthResult["status"];
  readonly storageMode: ErpFinancialsFixtureSmokeHealthResult["storageMode"];
  readonly fixtureName: ErpFinancialsFixtureSmokeHealthResult["fixtureName"];
  readonly summaryHash: string;
  readonly rowCounts: Pick<
    ErpFinancialsFixtureSmokeHealthResult["rowCounts"],
    "fixture" | "reportSnapshots" | "reportFreshness" | "snapshotRowsWritten" | "freshnessRowsWritten"
  >;
  readonly reportStatuses: Readonly<Record<string, "pass" | "fail">>;
  readonly issueCount: number;
};

export type FutureErpInstallHealthPreflightResult = {
  readonly preflightName: "future_erp_install_health";
  readonly status: FutureErpInstallHealthPreflightStatus;
  readonly executionEnvironment: FutureErpInstallHealthPreflightEnvironment;
  readonly generatedAt: string;
  readonly install?: FutureErpInstallHealthPreflightInstallSummary;
  readonly fixtureSmoke?: FutureErpInstallHealthPreflightFixtureSmokeSummary;
  readonly checks: readonly FutureErpInstallHealthPreflightCheck[];
  readonly issues: readonly FutureErpInstallHealthPreflightIssue[];
};

export type FutureErpInstallHealthPreflightOptions = {
  readonly client?: PostgresQueryClient;
  readonly executionEnvironment?: FutureErpInstallHealthPreflightEnvironment;
  readonly generatedAt?: string;
  readonly manifest?: PostgresSchemaManifest;
  readonly fixtureSmoke?: ErpFinancialsFixtureSmokeHealthOptions;
};

export type FutureErpInstallHealthPreflightWorker = {
  preflight(
    request?: Pick<FutureErpInstallHealthPreflightOptions, "executionEnvironment" | "generatedAt">
  ): Promise<FutureErpInstallHealthPreflightResult>;
};

export function createFutureErpInstallHealthPreflightWorker(
  options: FutureErpInstallHealthPreflightOptions
): FutureErpInstallHealthPreflightWorker {
  return {
    preflight(request = {}) {
      return preflightFutureErpInstallHealth({
        ...options,
        ...request
      });
    }
  };
}

export async function preflightFutureErpInstallHealth(
  options: FutureErpInstallHealthPreflightOptions = {}
): Promise<FutureErpInstallHealthPreflightResult> {
  const executionEnvironment = options.executionEnvironment ?? "dev";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks: FutureErpInstallHealthPreflightCheck[] = [devTestOnlyCheck(executionEnvironment)];
  const issues: FutureErpInstallHealthPreflightIssue[] = [];

  if (!isDevOrTestEnvironment(executionEnvironment)) {
    issues.push({
      kind: "environment_not_allowed",
      severity: "blocker",
      checkName: "dev_test_only_execution",
      message: "Future ERP install health preflight is only available in dev and test environments."
    });
  }

  let install: FutureErpInstallHealthPreflightInstallSummary | undefined;
  if (options.client === undefined) {
    checks.push(missingClientCheck());
    issues.push({
      kind: "postgres_client_missing",
      severity: "blocker",
      checkName: "erp_financials_install_schema",
      message: "Future ERP install health preflight requires a host Postgres client."
    });
  } else {
    const installHealth = await checkErpFinancialsInstallHealth(options.client, {
      ...(options.manifest === undefined ? {} : { manifest: options.manifest })
    });
    install = summarizeInstallHealth(installHealth);
    checks.push(...installChecks(install));
    issues.push(...installIssues(installHealth));
  }

  const fixtureSmoke = await runErpFinancialsFixtureSmokeHealth(options.fixtureSmoke);
  const fixtureSmokeSummary = summarizeFixtureSmoke(fixtureSmoke);
  checks.push(fixtureSmokeCheck(fixtureSmokeSummary));
  if (fixtureSmoke.status !== "healthy") {
    issues.push({
      kind: "fixture_smoke_degraded",
      severity: "warning",
      checkName: "erp_financials_fixture_smoke",
      message: "ERP Financials deterministic fixture smoke checks returned degraded results."
    });
  }

  return {
    preflightName: "future_erp_install_health",
    status: preflightStatus(checks, issues),
    executionEnvironment,
    generatedAt,
    ...(install === undefined ? {} : { install }),
    fixtureSmoke: fixtureSmokeSummary,
    checks,
    issues
  };
}

function devTestOnlyCheck(
  executionEnvironment: FutureErpInstallHealthPreflightEnvironment
): FutureErpInstallHealthPreflightCheck {
  return {
    name: "dev_test_only_execution",
    status: isDevOrTestEnvironment(executionEnvironment) ? "pass" : "fail",
    issueCount: isDevOrTestEnvironment(executionEnvironment) ? 0 : 1,
    message: isDevOrTestEnvironment(executionEnvironment)
      ? "Preflight execution is allowed."
      : "Preflight execution is blocked outside dev and test."
  };
}

function missingClientCheck(): FutureErpInstallHealthPreflightCheck {
  return {
    name: "erp_financials_install_schema",
    status: "fail",
    issueCount: 1,
    message: "Host Postgres client was not provided."
  };
}

function installChecks(
  install: FutureErpInstallHealthPreflightInstallSummary
): readonly FutureErpInstallHealthPreflightCheck[] {
  return [
    {
      name: "erp_financials_install_schema",
      status: install.compatible ? "pass" : "fail",
      issueCount: install.issueCounts.schema,
      message: install.compatible ? "Canonical schema is compatible." : "Canonical schema is incompatible."
    },
    {
      name: "erp_financials_fixture_support",
      status: install.fixtureSupport ? "pass" : "fail",
      issueCount: install.issueCounts.fixtureSupport,
      message: install.fixtureSupport ? "Canonical schema supports fixture smoke checks." : "Fixture support is incomplete."
    },
    {
      name: "erp_financials_sensitive_column_boundary",
      status: install.sensitiveColumnBoundary === "pass" ? "pass" : "fail",
      issueCount: install.issueCounts.sensitiveColumnBoundary,
      message:
        install.sensitiveColumnBoundary === "pass"
          ? "Canonical schema keeps provider material out of ERP-owned tables."
          : "Canonical schema includes disallowed sensitive columns."
    }
  ];
}

function fixtureSmokeCheck(
  fixtureSmoke: FutureErpInstallHealthPreflightFixtureSmokeSummary
): FutureErpInstallHealthPreflightCheck {
  return {
    name: "erp_financials_fixture_smoke",
    status: fixtureSmoke.status === "healthy" ? "pass" : "warn",
    issueCount: fixtureSmoke.issueCount,
    message:
      fixtureSmoke.status === "healthy"
        ? "Deterministic fixture smoke checks passed."
        : "Deterministic fixture smoke checks returned degraded results."
  };
}

function summarizeInstallHealth(
  health: ErpFinancialsInstallHealthResult
): FutureErpInstallHealthPreflightInstallSummary {
  return {
    packageName: health.packageName,
    packageVersion: health.packageVersion,
    manifestVersion: health.manifestVersion,
    schemaVersion: health.schemaVersion,
    namespace: health.schema.namespace,
    dialect: health.schema.dialect,
    compatible: health.schema.compatible,
    fixtureSupport: health.schema.fixtureSupport,
    sensitiveColumnBoundary: health.schema.noCredentialColumns ? "pass" : "fail",
    issueCounts: {
      schema: health.checks.find((check) => check.name === "schema_compatibility")?.issueCount ?? 0,
      fixtureSupport: health.checks.find((check) => check.name === "fixture_support")?.issueCount ?? 0,
      sensitiveColumnBoundary: health.checks.find((check) => check.name === "no_credential_columns")?.issueCount ?? 0
    }
  };
}

function summarizeFixtureSmoke(
  health: ErpFinancialsFixtureSmokeHealthResult
): FutureErpInstallHealthPreflightFixtureSmokeSummary {
  return {
    status: health.status,
    storageMode: health.storageMode,
    fixtureName: health.fixtureName,
    summaryHash: health.summaryHash,
    rowCounts: {
      fixture: health.rowCounts.fixture,
      reportSnapshots: health.rowCounts.reportSnapshots,
      reportFreshness: health.rowCounts.reportFreshness,
      snapshotRowsWritten: health.rowCounts.snapshotRowsWritten,
      freshnessRowsWritten: health.rowCounts.freshnessRowsWritten
    },
    reportStatuses: Object.fromEntries(
      Object.entries(health.reports).map(([reportName, report]) => [reportName, report.status])
    ),
    issueCount: health.issues.length
  };
}

function installIssues(health: ErpFinancialsInstallHealthResult): readonly FutureErpInstallHealthPreflightIssue[] {
  const issues: FutureErpInstallHealthPreflightIssue[] = [];

  if (!health.schema.compatible) {
    issues.push({
      kind: "schema_incompatible",
      severity: "blocker",
      checkName: "erp_financials_install_schema",
      message: issueSummary(health.issues, "Canonical schema is incompatible with @handrail/erp-financials.")
    });
  }

  if (!health.schema.fixtureSupport) {
    issues.push({
      kind: "fixture_support_missing",
      severity: "blocker",
      checkName: "erp_financials_fixture_support",
      message: "Canonical schema is missing the required fixture smoke support."
    });
  }

  if (!health.schema.noCredentialColumns) {
    issues.push({
      kind: "sensitive_column_boundary_failed",
      severity: "blocker",
      checkName: "erp_financials_sensitive_column_boundary",
      message: "Canonical schema contains disallowed sensitive columns."
    });
  }

  return issues;
}

function issueSummary(issues: readonly ErpFinancialsInstallHealthIssue[], fallback: string): string {
  const safeIssues = issues
    .filter((issue) => issue.kind !== "credential_column")
    .slice(0, 5)
    .map((issue) => `${issue.kind}:${issue.table === undefined ? "" : `${issue.table}.`}${issue.objectName}`);

  return safeIssues.length === 0 ? fallback : safeIssues.join("; ");
}

function preflightStatus(
  checks: readonly FutureErpInstallHealthPreflightCheck[],
  issues: readonly FutureErpInstallHealthPreflightIssue[]
): FutureErpInstallHealthPreflightStatus {
  if (issues.some((issue) => issue.severity === "blocker") || checks.some((check) => check.status === "fail")) {
    return "blocked";
  }

  return checks.some((check) => check.status === "warn") ? "degraded" : "healthy";
}

function isDevOrTestEnvironment(environment: FutureErpInstallHealthPreflightEnvironment): boolean {
  return environment === "dev" || environment === "test";
}
