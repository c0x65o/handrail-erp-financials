import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const release = JSON.parse(
  readFileSync(new URL("../releases/v0.3.32.json", import.meta.url), "utf8")
);
const installSpec = readArgument("--install-spec") ?? release.installSpec;
const consumerDirectory = mkdtempSync(join(tmpdir(), "erp-financials-v0.3.32-consumer-"));

try {
  writeFileSync(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "erp-financials-release-consumer", private: true, type: "module" }, null, 2)}\n`
  );

  execFileSync("npm", ["install", "--save-exact", installSpec], {
    cwd: consumerDirectory,
    stdio: "inherit"
  });

  const installedManifest = JSON.parse(
    readFileSync(
      join(consumerDirectory, "node_modules", "@handrail", "erp-financials", "package.json"),
      "utf8"
    )
  );
  const installedExports = Object.keys(installedManifest.exports ?? {});

  if (installedManifest.name !== release.packageName || installedManifest.version !== release.version) {
    throw new Error(
      `Installed ${installedManifest.name}@${installedManifest.version}; expected ${release.packageName}@${release.version}`
    );
  }
  if (JSON.stringify(installedExports) !== JSON.stringify(release.publicExports)) {
    throw new Error(
      `Installed exports ${JSON.stringify(installedExports)}; expected ${JSON.stringify(release.publicExports)}`
    );
  }

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'import { ERP_FINANCIALS_PACKAGE } from "@handrail/erp-financials";',
        'import { createErpFinancialsSdk } from "@handrail/erp-financials/sdk";',
        `if (ERP_FINANCIALS_PACKAGE.version !== ${JSON.stringify(release.version)}) throw new Error("root export version mismatch");`,
        'if (typeof createErpFinancialsSdk !== "function") throw new Error("SDK export is unavailable");'
      ].join("\n")
    ],
    { cwd: consumerDirectory, stdio: "inherit" }
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        package: `${release.packageName}@${release.version}`,
        installSpec,
        exports: installedExports,
        status: "installed"
      },
      null,
      2
    )}\n`
  );
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true });
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
