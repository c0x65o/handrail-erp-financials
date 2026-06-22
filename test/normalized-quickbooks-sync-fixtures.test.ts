import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES,
  assertNoCredentialKeys,
  assertSafeSourcePayloadRef
} from "../src/index.js";

import type { SafeSourcePayloadRef } from "../src/index.js";

const FORBIDDEN_FIXTURE_KEY_PATTERN =
  /(^|_|\b)(access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|secret|password|authorization|rawPayload|rawProviderPayload|providerPayloadArchive|payloadArchive|rawArchive)($|_|\b)/i;

describe("normalized QuickBooks sync fixtures", () => {
  it("serialize deterministically as bounded review fixtures", () => {
    const serialized = JSON.stringify(ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES, null, 2);
    const reparsed = JSON.stringify(JSON.parse(serialized), null, 2);

    expect(reparsed).toBe(serialized);
    expect(findUndefinedPaths(ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES)).toEqual([]);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "a7590dcb8a368dda4318f3c9d17dc41a5f5491e3ccd7b272595ca3436412ac30"
    );
  });

  it("cover full sync, incremental sync, checkpoint replay, provider reports, and reconciliation differences", () => {
    const fixtures = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES;

    expect(fixtures.fullSync.response.syncMode).toBe("full");
    expect(fixtures.fullSync.response).toMatchObject({
      providerEnvironment: "sandbox",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z"
    });
    expect(fixtures.fullSync.response.checkpoint).toMatchObject({
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z"
    });
    expect(fixtures.fullSync.response.resources.companyInfo.resourceId).toBe("realm_qbo_sync_fixture");
    expect(fixtures.fullSync.response.resourceCounts).toEqual({
      accounts: 2,
      classes: 0,
      companyInfo: 1,
      customers: 1,
      departments: 1,
      dimensions: 1,
      items: 1,
      journalEntries: 1,
      ledgerEntries: 1,
      ledgerPostings: 2,
      ledgerTransactions: 0,
      parties: 0,
      providerReports: 0,
      reconciliationEvidence: 0,
      vendors: 1
    });

    expect(fixtures.incrementalSync.response.syncMode).toBe("incremental");
    expect(fixtures.incrementalSync.response.status).toBe("completed_with_warnings");
    expect(fixtures.incrementalSync.response).toMatchObject({
      providerEnvironment: "sandbox",
      sourceFreshThrough: "2026-02-01T10:10:00.000Z",
      importedThrough: "2026-02-01T10:10:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:08:00.000Z"
    });
    expect(fixtures.incrementalSync.request.warningSummary?.items?.[0]?.sourcePayloadRef?.storageRef).toBe(
      "quickbooks-sdk://sandbox/realm/realm_qbo_sync_fixture/Vendor/vendor_skipped"
    );

    expect(fixtures.checkpointReplay.request.resumeFromCheckpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(fixtures.checkpointReplay.response.importBatchId).toBe("batch_qbo_checkpoint_replay_fixture_2026_02_01");
    expect(fixtures.checkpointReplay.response.checkpoint?.sourceObject).toBe("quickbooks_checkpoint_replay");

    expect(fixtures.providerReports.profitAndLoss.response.supportStatus).toBe("supported");
    expect(fixtures.providerReports.profitAndLoss.response).toMatchObject({
      providerEnvironment: "sandbox",
      importBatchId: "batch_qbo_full_fixture_2026_01",
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      sourceFreshThrough: "2026-02-01T10:01:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T10:01:00.000Z"
    });
    expect(fixtures.providerReports.profitAndLoss.response.requestedAt).toBe(fixtures.providerReports.profitAndLoss.request.requestedAt);
    expect(fixtures.providerReports.balanceSheet.response.asOfDate).toBe("2026-01-31");
    expect(fixtures.providerReports.trialBalance.response.totals).toHaveLength(3);
    expect(fixtures.providerReports.cashFlow.response).toMatchObject({
      reportName: "cash_flow",
      supportStatus: "unsupported",
      unsupportedReason: "quickbooks_cash_flow_parity_report_not_supported"
    });

    expect(fixtures.reconciliationDifferences.matchedProfitAndLoss.reconciliationStatus).toBe("balanced");
    expect(fixtures.reconciliationDifferences.outOfBalanceProfitAndLoss).toMatchObject({
      reconciliationStatus: "out_of_balance",
      reconciliationDifference: "0.03"
    });
    expect(fixtures.reconciliationDifferences.missingProviderTotal.totals.at(-1)).toMatchObject({
      totalKey: "other_income",
      status: "missing",
      providerAmount: "0.00",
      difference: "-25.00"
    });

    expect(fixtures.serviceHealth.ready.response).toMatchObject({
      status: "ready",
      serviceAvailability: "available",
      providerMode: "sandbox",
      providerEnvironment: "sandbox"
    });
    expect(fixtures.serviceHealth.ready.response.capabilities.replay.available).toBe(true);
    expect(fixtures.serviceHealth.ready.response.checkpoint).toMatchObject({
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      status: "current",
      sourceFreshThrough: "2026-02-01T10:00:00.000Z",
      importedThrough: "2026-02-01T10:00:00.000Z"
    });
    expect(fixtures.serviceHealth.degraded.response).toMatchObject({
      status: "degraded",
      serviceAvailability: "degraded"
    });
    expect(fixtures.serviceHealth.degraded.response.checkpoint.status).toBe("replay_required");
    expect(fixtures.serviceHealth.unavailable.response).toMatchObject({
      status: "unavailable",
      serviceAvailability: "unavailable"
    });
    expect(fixtures.serviceHealth.unavailable.response.capabilities.sandbox.available).toBe(false);
  });

  it("keep safe source refs and exclude credential-like or raw payload archive keys", () => {
    const fixtures = ERP_FINANCIALS_NORMALIZED_QUICKBOOKS_SYNC_FIXTURES;
    const serialized = JSON.stringify(fixtures);
    const sourceRefs = collectSourcePayloadRefs(fixtures);

    expect(serialized).not.toMatch(FORBIDDEN_FIXTURE_KEY_PATTERN);
    expect(findForbiddenKeyPaths(fixtures)).toEqual([]);
    expect(sourceRefs.length).toBeGreaterThan(10);
    expect(sourceRefs.every((ref) => ref.storageRef?.startsWith("quickbooks-sdk://sandbox/realm/realm_qbo_sync_fixture/"))).toBe(true);

    assertNoCredentialKeys(fixtures);
    for (const sourceRef of sourceRefs) {
      assertSafeSourcePayloadRef(sourceRef);
    }
  });
});

function findUndefinedPaths(value: unknown, path = "$"): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findUndefinedPaths(entry, `${path}[${String(index)}]`));
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      entry === undefined ? [`${path}.${key}`] : findUndefinedPaths(entry, `${path}.${key}`)
    );
  }

  return [];
}

function collectSourcePayloadRefs(value: unknown): readonly SafeSourcePayloadRef[] {
  const refs: SafeSourcePayloadRef[] = [];
  visitObjectEntries(value, (key, entry) => {
    if ((key === "sourcePayloadRef" || key === "drilldownRef") && isSourcePayloadRef(entry)) {
      refs.push(entry);
    }
  });
  return refs;
}

function findForbiddenKeyPaths(value: unknown): readonly string[] {
  const paths: string[] = [];
  visitObjectEntries(value, (key, _entry, entryPath) => {
    if (FORBIDDEN_FIXTURE_KEY_PATTERN.test(key)) {
      paths.push(entryPath);
    }
  });
  return paths;
}

function visitObjectEntries(
  value: unknown,
  visitor: (key: string, entry: unknown, path: string) => void,
  path = "$"
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      visitObjectEntries(entry, visitor, `${path}[${String(index)}]`);
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const entryPath = `${path}.${key}`;
      visitor(key, entry, entryPath);
      visitObjectEntries(entry, visitor, entryPath);
    }
  }
}

function isSourcePayloadRef(value: unknown): value is SafeSourcePayloadRef {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as SafeSourcePayloadRef).sourceObjectType === "string" &&
    typeof (value as SafeSourcePayloadRef).sourceObjectId === "string"
  );
}
