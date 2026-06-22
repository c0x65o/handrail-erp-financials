import { ERP_FINANCIALS_PACKAGE } from "./package-boundary.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";
import { POSTGRES_CANONICAL_SCHEMA_MANIFEST, assertManifestHasNoCredentialColumns } from "./schema-manifest.js";

import type {
  PostgresQueryClient,
  PostgresSchemaValidationIssue,
  PostgresSchemaValidationIssueKind
} from "./postgres-storage.js";
import type { PostgresSchemaManifest } from "./schema-manifest.js";

export type ErpFinancialsInstallHealthStatus = "healthy" | "degraded";
export type ErpFinancialsInstallHealthCheckStatus = "pass" | "fail";

export type ErpFinancialsInstallHealthIssueKind = PostgresSchemaValidationIssueKind | "schema_validation_failed";

export type ErpFinancialsInstallHealthIssue = {
  readonly kind: ErpFinancialsInstallHealthIssueKind;
  readonly table?: string;
  readonly objectName: string;
  readonly message: string;
};

export type ErpFinancialsInstallHealthCheck = {
  readonly name: "schema_compatibility" | "fixture_support" | "no_credential_columns";
  readonly status: ErpFinancialsInstallHealthCheckStatus;
  readonly issueCount: number;
};

export type ErpFinancialsInstallHealthIssueSummary = {
  readonly missingTables: readonly string[];
  readonly missingColumns: readonly string[];
  readonly missingIndexes: readonly string[];
  readonly missingConstraints: readonly string[];
  readonly credentialColumns: readonly string[];
};

export type ErpFinancialsInstallHealthSchema = {
  readonly namespace: PostgresSchemaManifest["namespace"];
  readonly dialect: PostgresSchemaManifest["dialect"];
  readonly compatible: boolean;
  readonly fixtureSupport: boolean;
  readonly noCredentialColumns: boolean;
  readonly issues: ErpFinancialsInstallHealthIssueSummary;
};

export type ErpFinancialsInstallHealthResult = {
  readonly packageName: typeof ERP_FINANCIALS_PACKAGE.name;
  readonly packageVersion: typeof ERP_FINANCIALS_PACKAGE.version;
  readonly manifestVersion: PostgresSchemaManifest["manifestVersion"];
  readonly schemaVersion: PostgresSchemaManifest["schemaVersion"];
  readonly status: ErpFinancialsInstallHealthStatus;
  readonly schema: ErpFinancialsInstallHealthSchema;
  readonly checks: readonly ErpFinancialsInstallHealthCheck[];
  readonly issues: readonly ErpFinancialsInstallHealthIssue[];
};

export type ErpFinancialsInstallHealthOptions = {
  readonly manifest?: PostgresSchemaManifest;
};

export async function checkErpFinancialsInstallHealth(
  client: PostgresQueryClient,
  options: ErpFinancialsInstallHealthOptions = {}
): Promise<ErpFinancialsInstallHealthResult> {
  const manifest = options.manifest ?? POSTGRES_CANONICAL_SCHEMA_MANIFEST;

  try {
    assertManifestHasNoCredentialColumns(manifest);
    const validation = await createPostgresStorageAdapter(client, manifest).validateSchema();
    const issues = validation.issues.map(sanitizeSchemaIssue);

    return buildInstallHealthResult({
      manifest,
      compatible: validation.compatible,
      fixtureSupport: validation.fixtureSupport,
      noCredentialColumns: !issues.some((issue) => issue.kind === "credential_column"),
      issues
    });
  } catch (error) {
    const issue = sanitizeHealthError(error);

    return buildInstallHealthResult({
      manifest,
      compatible: false,
      fixtureSupport: false,
      noCredentialColumns: issue.kind !== "credential_column",
      issues: [issue]
    });
  }
}

function buildInstallHealthResult(input: {
  readonly manifest: PostgresSchemaManifest;
  readonly compatible: boolean;
  readonly fixtureSupport: boolean;
  readonly noCredentialColumns: boolean;
  readonly issues: readonly ErpFinancialsInstallHealthIssue[];
}): ErpFinancialsInstallHealthResult {
  const schemaCompatibilityIssueCount = input.issues.filter((issue) => issue.kind !== "missing_fixture_support").length;
  const fixtureIssueCount = input.issues.filter((issue) => issue.kind === "missing_fixture_support").length;
  const credentialIssueCount = input.issues.filter((issue) => issue.kind === "credential_column").length;
  const schema = {
    namespace: input.manifest.namespace,
    dialect: input.manifest.dialect,
    compatible: input.compatible,
    fixtureSupport: input.fixtureSupport,
    noCredentialColumns: input.noCredentialColumns,
    issues: summarizeIssues(input.issues)
  };

  return {
    packageName: ERP_FINANCIALS_PACKAGE.name,
    packageVersion: ERP_FINANCIALS_PACKAGE.version,
    manifestVersion: input.manifest.manifestVersion,
    schemaVersion: input.manifest.schemaVersion,
    status: input.compatible && input.fixtureSupport && input.noCredentialColumns ? "healthy" : "degraded",
    schema,
    checks: [
      {
        name: "schema_compatibility",
        status: input.compatible ? "pass" : "fail",
        issueCount: schemaCompatibilityIssueCount
      },
      {
        name: "fixture_support",
        status: input.fixtureSupport ? "pass" : "fail",
        issueCount: fixtureIssueCount
      },
      {
        name: "no_credential_columns",
        status: input.noCredentialColumns ? "pass" : "fail",
        issueCount: credentialIssueCount
      }
    ],
    issues: input.issues
  };
}

function summarizeIssues(issues: readonly ErpFinancialsInstallHealthIssue[]): ErpFinancialsInstallHealthIssueSummary {
  return {
    missingTables: sortedUnique(
      issues.filter((issue) => issue.kind === "missing_table").map((issue) => issue.objectName)
    ),
    missingColumns: sortedUnique(
      issues
        .filter((issue) => issue.kind === "missing_column")
        .map((issue) => qualifiedObjectName(issue.table, issue.objectName))
    ),
    missingIndexes: sortedUnique(
      issues.filter((issue) => issue.kind === "missing_index").map((issue) => issue.objectName)
    ),
    missingConstraints: sortedUnique(
      issues
        .filter((issue) => issue.kind === "missing_constraint")
        .map((issue) => qualifiedObjectName(issue.table, issue.objectName))
    ),
    credentialColumns: sortedUnique(
      issues
        .filter((issue) => issue.kind === "credential_column")
        .map((issue) => qualifiedObjectName(issue.table, issue.objectName))
    )
  };
}

function sanitizeSchemaIssue(issue: PostgresSchemaValidationIssue): ErpFinancialsInstallHealthIssue {
  return {
    kind: issue.kind,
    ...(issue.table === undefined ? {} : { table: safeIdentifier(issue.table) }),
    objectName: safeIdentifier(issue.objectName),
    message: issue.message
  };
}

function sanitizeHealthError(error: unknown): ErpFinancialsInstallHealthIssue {
  if (error instanceof Error && /credential-like column is not allowed/i.test(error.message)) {
    return {
      kind: "credential_column",
      objectName: "manifest",
      message: "manifest contains credential-like column names"
    };
  }

  return {
    kind: "schema_validation_failed",
    objectName: "schema_validation",
    message: "schema validation failed before compatibility could be confirmed"
  };
}

function qualifiedObjectName(table: string | undefined, objectName: string): string {
  return table === undefined ? objectName : `${table}.${objectName}`;
}

function safeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
