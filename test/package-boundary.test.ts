import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_PACKAGE,
  PACKAGE_BOUNDARY,
  describePackageBoundary
} from "../src/index.js";

describe("package boundary", () => {
  it("exports a provider-neutral library surface for host ERP apps", () => {
    expect(ERP_FINANCIALS_PACKAGE.name).toBe("@handrail/erp-financials");
    expect(PACKAGE_BOUNDARY.purpose).toContain("provider-neutral");
    expect(PACKAGE_BOUNDARY.owns).toContain("canonical accounting facts");
    expect(PACKAGE_BOUNDARY.owns).toContain("rollup and snapshot jobs");
  });

  it("keeps app UI and provider credential custody outside the package", () => {
    const boundary = describePackageBoundary();

    expect(boundary.excludes).toContain("app-specific UI");
    expect(boundary.excludes).toContain("provider OAuth");
    expect(boundary.excludes).toContain("provider token storage");
    expect(boundary.sourceAdapterBoundary).toContain("canonical accounting facts");
  });
});
