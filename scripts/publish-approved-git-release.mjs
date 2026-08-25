import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const manifestUrl = new URL("../releases/v0.3.32.json", import.meta.url);
const release = JSON.parse(readFileSync(manifestUrl, "utf8"));
const publish = process.argv.includes("--publish");

assertReleaseManifest(release);
assertCommitPackage(release);
assertLocalTag(release);

const remoteCommitBefore = readRemoteTagCommit(release.tag);
if (remoteCommitBefore !== null && remoteCommitBefore !== release.commit) {
  throw new Error(
    `Refusing to change remote ${release.tag}: expected ${release.commit}, found ${remoteCommitBefore}`
  );
}

if (publish && remoteCommitBefore === null) {
  if (!localTagExists(release.tag)) {
    execFileSync("git", ["update-ref", `refs/tags/${release.tag}`, release.commit], {
      stdio: "inherit"
    });
  }

  execFileSync(
    "git",
    ["push", "origin", `refs/tags/${release.tag}:refs/tags/${release.tag}`],
    { stdio: "inherit" }
  );
}

const remoteCommitAfter = readRemoteTagCommit(release.tag);
if (publish && remoteCommitAfter !== release.commit) {
  throw new Error(
    `Remote ${release.tag} did not resolve to ${release.commit} after publication`
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      tag: release.tag,
      approvedCommit: release.commit,
      localTagCommit: readLocalTagCommit(release.tag),
      remoteTagCommit: remoteCommitAfter,
      action: publish ? (remoteCommitBefore === null ? "published" : "already_published") : "verified"
    },
    null,
    2
  )}\n`
);

function assertReleaseManifest(candidate) {
  const expected = {
    packageName: "@handrail/erp-financials",
    version: "0.3.32",
    tag: "v0.3.32",
    commit: "be77c72d01331e8e0371a532d4569996286d1306"
  };

  for (const [field, value] of Object.entries(expected)) {
    if (candidate[field] !== value) {
      throw new Error(`Release manifest ${field} must be ${value}`);
    }
  }
}

function assertCommitPackage(candidate) {
  execFileSync("git", ["cat-file", "-e", `${candidate.commit}^{commit}`]);
  const packageManifest = JSON.parse(
    execFileSync("git", ["show", `${candidate.commit}:package.json`], { encoding: "utf8" })
  );
  const exportNames = Object.keys(packageManifest.exports ?? {});

  if (packageManifest.name !== candidate.packageName || packageManifest.version !== candidate.version) {
    throw new Error(
      `Approved commit package must be ${candidate.packageName}@${candidate.version}`
    );
  }
  if (JSON.stringify(exportNames) !== JSON.stringify(candidate.publicExports)) {
    throw new Error(
      `Approved commit exports ${JSON.stringify(exportNames)}, expected ${JSON.stringify(candidate.publicExports)}`
    );
  }
}

function assertLocalTag(candidate) {
  if (!localTagExists(candidate.tag)) {
    return;
  }

  const localCommit = readLocalTagCommit(candidate.tag);
  if (localCommit !== candidate.commit) {
    throw new Error(
      `Refusing to change local ${candidate.tag}: expected ${candidate.commit}, found ${localCommit}`
    );
  }
}

function localTagExists(tag) {
  return spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`]).status === 0;
}

function readLocalTagCommit(tag) {
  if (!localTagExists(tag)) {
    return null;
  }
  return execFileSync("git", ["rev-parse", `${tag}^{}`], { encoding: "utf8" }).trim();
}

function readRemoteTagCommit(tag) {
  const result = spawnSync(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Unable to inspect remote tag ${tag}`);
  }

  const refs = new Map(
    result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/u).reverse())
  );
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}
