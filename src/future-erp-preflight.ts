import { createPostgresStorageAdapter } from "./postgres-storage.js";
import type {
  InstallPostgresSchemaResult,
  PostgresQueryClient,
  PostgresSchemaValidationIssue,
  PostgresSchemaValidationResult
} from "./postgres-storage.js";

export const FUTURE_ERP_CANONICAL_SCHEMA_PREFLIGHT_ERROR_CODE =
  "FUTURE_ERP_CANONICAL_SCHEMA_PREFLIGHT_FAILED" as const;

export type FutureErpCanonicalSchemaPreflightOptions = {
  readonly jobName?: string;
  readonly installSchemaIfMissing?: boolean;
};

export type FutureErpCanonicalSchemaPreflightResult = PostgresSchemaValidationResult & {
  readonly install?: InstallPostgresSchemaResult;
};

export type FutureErpCanonicalSchemaPreflightFailure = {
  readonly code: typeof FUTURE_ERP_CANONICAL_SCHEMA_PREFLIGHT_ERROR_CODE;
  readonly jobName: string;
  readonly message: string;
  readonly validation: PostgresSchemaValidationResult;
  readonly issues: readonly PostgresSchemaValidationIssue[];
};

export class FutureErpCanonicalSchemaPreflightError extends Error {
  readonly code = FUTURE_ERP_CANONICAL_SCHEMA_PREFLIGHT_ERROR_CODE;
  readonly jobName: string;
  readonly validation: PostgresSchemaValidationResult;
  readonly issues: readonly PostgresSchemaValidationIssue[];

  constructor(failure: FutureErpCanonicalSchemaPreflightFailure) {
    super(failure.message);
    this.name = "FutureErpCanonicalSchemaPreflightError";
    this.jobName = failure.jobName;
    this.validation = failure.validation;
    this.issues = failure.issues;
  }

  toJSON(): FutureErpCanonicalSchemaPreflightFailure {
    return {
      code: this.code,
      jobName: this.jobName,
      message: this.message,
      validation: this.validation,
      issues: this.issues
    };
  }
}

export async function validateFutureErpCanonicalSchemaPreflight(
  existingPostgresClient: PostgresQueryClient,
  options: FutureErpCanonicalSchemaPreflightOptions = {}
): Promise<FutureErpCanonicalSchemaPreflightResult> {
  const storage = createPostgresStorageAdapter(existingPostgresClient);
  const install = options.installSchemaIfMissing === true ? await storage.installSchema() : undefined;
  const validation = await storage.validateSchema();

  if (!validation.compatible) {
    throw new FutureErpCanonicalSchemaPreflightError(toFutureErpCanonicalSchemaPreflightFailure(validation, options));
  }

  return {
    ...validation,
    ...(install === undefined ? {} : { install })
  };
}

export function toFutureErpCanonicalSchemaPreflightFailure(
  validation: PostgresSchemaValidationResult,
  options: FutureErpCanonicalSchemaPreflightOptions = {}
): FutureErpCanonicalSchemaPreflightFailure {
  const jobName = options.jobName ?? "future-erp-canonical-import";
  const issueMessages = validation.issues.map(formatIssue).join("; ");
  const details = issueMessages.length === 0 ? "schema validation returned incompatible without issue details" : issueMessages;

  return {
    code: FUTURE_ERP_CANONICAL_SCHEMA_PREFLIGHT_ERROR_CODE,
    jobName,
    message: `${FUTURE_ERP_CANONICAL_SCHEMA_PREFLIGHT_ERROR_CODE}: ${jobName}: ${details}`,
    validation,
    issues: validation.issues
  };
}

function formatIssue(issue: PostgresSchemaValidationIssue): string {
  const table = issue.table === undefined ? "" : `${issue.table}.`;

  return `${issue.kind}:${table}${issue.objectName}:${issue.message}`;
}
