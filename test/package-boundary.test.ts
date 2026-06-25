import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  ERP_FINANCIALS_PACKAGE,
  PACKAGE_BOUNDARY,
  AccountHierarchyValidationError,
  assertValidAccountHierarchy,
  buildAccountHierarchyRollupLines,
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildFutureErpReportFromCanonicalReadModel,
  buildProfitAndLossReport,
  buildReferenceStandardReportPresentationFromFacts,
  buildStandardReportPresentationFromFacts,
  buildTrialBalanceReport,
  checkErpFinancialsInstallHealth,
  createFutureErpCanonicalFactPersistenceWorker,
  createFutureErpQuickBooksFullSyncWorker,
  createFutureErpQuickBooksIncrementalSyncWorker,
  createFutureErpRollupAndLateArrivalWorker,
  createFutureErpSnapshotRefreshAndFreshnessWorker,
  createHandrailQuickBooksFullSyncServiceHandler,
  createHandrailQuickBooksSyncClient,
  createPostgresStorageAdapter,
  createSnapshotRefreshContract,
  describePackageBoundary,
  mapHandrailQuickBooksSdkResourcesToCanonicalFacts,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts,
  mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts,
  persistFutureErpCanonicalFacts,
  reconcileReportFreshness,
  renderPostgresSchemaSql,
  validateAccountHierarchy,
  validateFutureErpCanonicalSchemaPreflight,
  validatePostgresSchema
} from "../src/index.js";

import type { Account, AccountHierarchyDiagnostic, AccountId } from "../src/index.js";

describe("package boundary", () => {
  it("keeps runtime package metadata aligned with the package manifest", () => {
    const packageManifest = readPackageManifest();

    expect(ERP_FINANCIALS_PACKAGE.name).toBe(packageManifest.name);
    expect(ERP_FINANCIALS_PACKAGE.version).toBe(packageManifest.version);
    expect(describePackageBoundary().packageVersion).toBe(packageManifest.version);
  });

  it("exports a provider-neutral library surface for host ERP apps", () => {
    expect(ERP_FINANCIALS_PACKAGE.name).toBe("@handrail/erp-financials");
    expect(PACKAGE_BOUNDARY.purpose).toContain("provider-neutral");
    expect(PACKAGE_BOUNDARY.owns).toContain("canonical accounting facts");
    expect(PACKAGE_BOUNDARY.owns).toContain("rollup and snapshot jobs");
    expect(PACKAGE_BOUNDARY.owns).toContain("deterministic fixture/reference report formulas");
    expect(publicAccountId("acct_cash")).toBe("acct_cash");
  });

  it("keeps app UI and provider credential custody outside the package", () => {
    const boundary = describePackageBoundary();

    expect(boundary.excludes).toContain("app-specific UI");
    expect(boundary.excludes).toContain("provider OAuth");
    expect(boundary.excludes).toContain("provider token storage");
    expect(boundary.sourceAdapterBoundary).toContain("canonical accounting facts");
  });

  it("keeps root package exports as the only public package entry point", () => {
    const packageManifest = readPackageManifest();

    expect(packageManifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js"
      }
    });
  });

  it("keeps the documented adoption allowlist available from the root barrel", () => {
    const supportedRuntimeExports = [
      POSTGRES_CANONICAL_SCHEMA_MANIFEST,
      renderPostgresSchemaSql,
      createPostgresStorageAdapter,
      validatePostgresSchema,
      checkErpFinancialsInstallHealth,
      validateFutureErpCanonicalSchemaPreflight,
      createFutureErpCanonicalFactPersistenceWorker,
      persistFutureErpCanonicalFacts,
      mapHandrailQuickBooksSdkResourcesToCanonicalFacts,
      mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts,
      mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts,
      createFutureErpQuickBooksFullSyncWorker,
      createFutureErpQuickBooksIncrementalSyncWorker,
      createHandrailQuickBooksFullSyncServiceHandler,
      createHandrailQuickBooksSyncClient,
      buildProfitAndLossReport,
      buildBalanceSheetReport,
      buildTrialBalanceReport,
      buildCashFlowReport,
      buildReferenceStandardReportPresentationFromFacts,
      buildFutureErpReportFromCanonicalReadModel,
      createSnapshotRefreshContract,
      reconcileReportFreshness,
      createFutureErpRollupAndLateArrivalWorker,
      createFutureErpSnapshotRefreshAndFreshnessWorker,
      validateAccountHierarchy,
      assertValidAccountHierarchy,
      AccountHierarchyValidationError,
      buildAccountHierarchyRollupLines
    ];

    expect(POSTGRES_CANONICAL_SCHEMA_MANIFEST.namespace).toBe("erp_financials");
    for (const supportedExport of supportedRuntimeExports) {
      expect(supportedExport).toBeDefined();
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- The package boundary intentionally keeps this alias available for existing consumers.
    expect(buildStandardReportPresentationFromFacts).toBe(buildReferenceStandardReportPresentationFromFacts);
  });

  it("preserves account hierarchy types and validation helpers at the root package boundary", () => {
    const parentAccount = packageBoundaryAccount("acct_income_parent");
    const childAccount: Account = {
      ...packageBoundaryAccount("acct_income_child"),
      parentAccountId: parentAccount.accountId
    };
    const diagnostics: readonly AccountHierarchyDiagnostic[] = validateAccountHierarchy([parentAccount, childAccount]);

    expect(childAccount.parentAccountId).toBe(parentAccount.accountId);
    expect(diagnostics).toEqual([]);
    expect(() => {
      assertValidAccountHierarchy([parentAccount, childAccount]);
    }).not.toThrow();
    expect(new AccountHierarchyValidationError([]).name).toBe("AccountHierarchyValidationError");
  });
});

type PackageManifest = {
  readonly name: string;
  readonly version: string;
  readonly exports: unknown;
};

function readPackageManifest(): PackageManifest {
  const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  if (!isPackageManifest(parsed)) {
    throw new Error("package.json must declare string name and version fields");
  }

  return parsed;
}

function isPackageManifest(value: unknown): value is PackageManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "version" in value &&
    typeof value.version === "string" &&
    "exports" in value
  );
}

function publicAccountId(accountId: AccountId): AccountId {
  return accountId;
}

function packageBoundaryAccount(accountId: AccountId): Account {
  return {
    accountId,
    tenantId: "tenant_package_boundary",
    sourceId: "source_package_boundary",
    sourceAccountId: accountId,
    accountNumber: accountId.replace("acct_", ""),
    name: accountId,
    type: "Income",
    classification: "income",
    active: true
  };
}
