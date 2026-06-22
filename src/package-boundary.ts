export const ERP_FINANCIALS_PACKAGE = {
  name: "@handrail/erp-financials",
  version: "0.1.2"
} as const;

export const PACKAGE_BOUNDARY = {
  purpose: "provider-neutral ERP financial reporting kernel",
  owns: [
    "canonical accounting facts",
    "schema and migration manifests",
    "deterministic report builders",
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
