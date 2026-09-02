import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const APPROVED_COMMIT = "be77c72d01331e8e0371a532d4569996286d1306";
const LEGACY_RELEASE_INSTALL_SPEC = "git+https://github.com/c0x65o/handrail-erp-financials.git#v0.3.32";
const CURRENT_INSTALL_SPEC = "git+https://github.com/c0x65o/handrail-sdk-erp-financials-js.git#v0.3.32";

describe("approved v0.3.32 release publication", () => {
  it("binds the immutable tag and BLU install spec to the approved commit", () => {
    const release = readJson(new URL("../releases/v0.3.32.json", import.meta.url));
    const tagCommit = execFileSync("git", ["rev-parse", "v0.3.32^{}"], {
      encoding: "utf8"
    }).trim();

    expect(release).toMatchObject({
      packageName: "@handrail/erp-financials",
      version: "0.3.32",
      tag: "v0.3.32",
      commit: APPROVED_COMMIT,
      installSpec: LEGACY_RELEASE_INSTALL_SPEC,
      publicExports: [".", "./sdk"]
    });
    expect(tagCommit).toBe(APPROVED_COMMIT);
  });

  it("publishes the expected package and declared exports from the approved commit", () => {
    const packageManifest = JSON.parse(
      execFileSync("git", ["show", `${APPROVED_COMMIT}:package.json`], {
        encoding: "utf8"
      })
    ) as Readonly<Record<string, unknown>>;

    expect(packageManifest.name).toBe("@handrail/erp-financials");
    expect(packageManifest.version).toBe("0.3.32");
    expect(Object.keys(packageManifest.exports as Readonly<Record<string, unknown>>)).toEqual([
      ".",
      "./sdk"
    ]);
  });

  it("records the exact pin and prohibits BLU-local package fallbacks", () => {
    const releaseGuide = readFileSync(
      new URL("../docs/blu-v0.3.32-release.md", import.meta.url),
      "utf8"
    );
    const publicationScript = readFileSync(
      new URL("../scripts/publish-approved-git-release.mjs", import.meta.url),
      "utf8"
    );

    expect(releaseGuide).toContain(CURRENT_INSTALL_SPEC);
    expect(releaseGuide).toContain(APPROVED_COMMIT);
    expect(releaseGuide).toContain("never force-pushes or replaces a tag");
    expect(releaseGuide).toContain("Do not replace this dependency with a copied package");
    expect(publicationScript).toContain(
      '`refs/tags/${release.tag}:refs/tags/${release.tag}`'
    );
    expect(publicationScript).not.toMatch(/push[^\n]*(?:--force|-f\b)/u);
  });
});

function readJson(url: URL): Readonly<Record<string, unknown>> {
  return JSON.parse(readFileSync(url, "utf8")) as Readonly<Record<string, unknown>>;
}
