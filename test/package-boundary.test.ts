import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_PACKAGE,
  PACKAGE_BOUNDARY,
  describePackageBoundary
} from "../src/index.js";

import type { AccountId } from "../src/index.js";

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
    expect(publicAccountId("acct_cash")).toBe("acct_cash");
  });

  it("keeps app UI and provider credential custody outside the package", () => {
    const boundary = describePackageBoundary();

    expect(boundary.excludes).toContain("app-specific UI");
    expect(boundary.excludes).toContain("provider OAuth");
    expect(boundary.excludes).toContain("provider token storage");
    expect(boundary.sourceAdapterBoundary).toContain("canonical accounting facts");
  });
});

type PackageManifest = {
  readonly name: string;
  readonly version: string;
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
    typeof value.version === "string"
  );
}

function publicAccountId(accountId: AccountId): AccountId {
  return accountId;
}
