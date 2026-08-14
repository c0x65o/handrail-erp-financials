import { readFileSync } from "node:fs";

const packageManifest = readPackageManifest();

export const ERP_FINANCIALS_PACKAGE = {
  name: packageManifest.name,
  version: packageManifest.version
};

export const PACKAGE_BOUNDARY = {
  purpose: "provider-neutral ERP accounting and financial reporting kernel",
  owns: [
    "canonical accounting facts",
    "account hierarchy and journal posting orchestration",
    "ordered database migrations and financial integrity constraints",
    "immutable financial lifecycle evidence",
    "fiscal periods, posting locks, and close controls",
    "journal reversal, correction, void, and replacement workflows",
    "receivable, payable, cash, and payment-application subledgers",
    "issued credit and refund void and replacement workflows",
    "transaction matching and posting rule evaluation",
    "reporting books, cross-source chart continuity, and effective source cutovers",
    "invoice lifecycle, payment matching, and bank reconciliation workflows",
    "book-aware paginated financial read models",
    "canonical credit and refund register and detail models",
    "stable SDK errors and transactional financial outbox delivery",
    "schema and migration manifests",
    "deterministic fixture/reference report formulas",
    "rollup and snapshot jobs",
    "freshness and cursor tracking",
    "drilldown evidence",
    "fixtures and validation utilities",
    "app-facing and AI-safe report APIs"
  ],
  excludes: [
    "app-specific UI",
    "tenant permissions",
    "provider OAuth",
    "provider token storage",
    "customer-specific workflows"
  ],
  sourceAdapterBoundary:
    "QuickBooks, native ERP, and future adapters produce canonical accounting facts before reports are built."
} as const;

export type KernelCapability = (typeof PACKAGE_BOUNDARY.owns)[number];
export type ExcludedCapability = (typeof PACKAGE_BOUNDARY.excludes)[number];
export type PackageBoundary = typeof PACKAGE_BOUNDARY;

export type PackageBoundaryDescription = {
  readonly packageName: typeof ERP_FINANCIALS_PACKAGE.name;
  readonly packageVersion: typeof ERP_FINANCIALS_PACKAGE.version;
  readonly purpose: PackageBoundary["purpose"];
  readonly owns: readonly KernelCapability[];
  readonly excludes: readonly ExcludedCapability[];
  readonly sourceAdapterBoundary: PackageBoundary["sourceAdapterBoundary"];
};

export function describePackageBoundary(): PackageBoundaryDescription {
  return {
    packageName: ERP_FINANCIALS_PACKAGE.name,
    packageVersion: ERP_FINANCIALS_PACKAGE.version,
    purpose: PACKAGE_BOUNDARY.purpose,
    owns: PACKAGE_BOUNDARY.owns,
    excludes: PACKAGE_BOUNDARY.excludes,
    sourceAdapterBoundary: PACKAGE_BOUNDARY.sourceAdapterBoundary
  };
}

function readPackageManifest(): { readonly name: string; readonly version: string } {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as unknown;

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    !("version" in manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("ERP Financials package manifest must declare string name and version fields.");
  }

  return {
    name: manifest.name,
    version: manifest.version
  };
}
