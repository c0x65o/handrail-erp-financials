import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertNoCredentialKeys,
  createPostgresStorageAdapter,
  runFutureErpQuickBooksSandboxReplay
} from "../src/index.js";

import type { PostgresQueryClient, PostgresQueryResult, PostgresStorageAdapter, ReportName } from "../src/index.js";

type ReplayStorageCall = {
  readonly method: ReplayWriteMethod;
  readonly entity: ReplayWriteEntity;
  readonly ids: readonly string[];
  readonly lineIds?: readonly string[];
  readonly totalIds?: readonly string[];
};

type ReplayWriteMethod =
  | "upsertAccountingCompany"
  | "upsertAccountingSource"
  | "upsertImportBatch"
  | "upsertSyncCheckpoint"
  | "upsertAccounts"
  | "upsertParties"
  | "upsertItems"
  | "upsertDimensions"
  | "upsertTransactions"
  | "upsertTransactionLines"
  | "upsertLedgerPostings"
  | "writeReportSnapshot"
  | "writeFreshnessRows";

type ReplayWriteEntity =
  | "companies"
  | "sources"
  | "import_batches"
  | "checkpoints"
  | "accounts"
  | "parties"
  | "items"
  | "dimensions"
  | "transactions"
  | "transaction_lines"
  | "postings"
  | "report_snapshots"
  | "snapshot_lines"
  | "snapshot_totals"
  | "freshness";

type QueryCall = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

const EXPECTED_REPLAY_WRITE_ENTITIES: readonly ReplayWriteEntity[] = [
  "companies",
  "sources",
  "import_batches",
  "checkpoints",
  "accounts",
  "parties",
  "items",
  "dimensions",
  "transactions",
  "transaction_lines",
  "postings",
  "report_snapshots",
  "snapshot_lines",
  "snapshot_totals",
  "freshness",
  "report_snapshots",
  "snapshot_lines",
  "snapshot_totals",
  "freshness",
  "report_snapshots",
  "snapshot_lines",
  "snapshot_totals",
  "freshness",
  "report_snapshots",
  "snapshot_lines",
  "snapshot_totals",
  "freshness"
];

const REPORT_NAMES: readonly ReportName[] = ["profit_and_loss", "balance_sheet", "trial_balance", "cash_flow"];
const EXPECTED_REPLAY_EVIDENCE_HASH = "58c60bb19d80807e36f5bd4de9f563af3e7c8eef0d894465bf18a6a13f27aec5";

describe("Future ERP QuickBooks sandbox replay orchestration", () => {
  it("returns a bounded deterministic replay result without credentials or raw provider payloads", async () => {
    const result = await runFutureErpQuickBooksSandboxReplay();

    expect(result.sourceIdentity).toEqual({
      tenantId: "tenant_qbo_sync_fixture",
      sourceId: "source_qbo_sync_fixture",
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      sourceCompanyRef: "realm_qbo_sync_fixture",
      realmId: "realm_qbo_sync_fixture",
      connectionRef: "handrail-quickbooks-sdk:staging:sandbox:realm:realm_qbo_sync_fixture",
      handrailQuickBooksServiceEnvironment: "staging"
    });
    expect(result.importBatchId).toBe("batch_qbo_full_fixture_2026_01");
    expect(result.checkpointId).toBe("checkpoint_qbo_full_fixture_2026_01");
    expect(result.importBatch).toEqual({
      importBatchId: "batch_qbo_full_fixture_2026_01",
      mode: "initial",
      status: "completed",
      startedAt: "2026-02-01T10:00:00.000Z",
      completedAt: "2026-02-01T10:00:05.000Z"
    });
    expect(result.checkpoint).toEqual({
      checkpointId: "checkpoint_qbo_full_fixture_2026_01",
      sourceObject: "quickbooks_full_sync",
      cursorKind: "full_scan",
      cursorValue: "full:realm_qbo_sync_fixture:2026-02-01T10:00:00.000Z",
      freshThrough: "2026-02-01T10:00:00.000Z",
      latestSourceUpdatedAt: "2026-02-01T09:59:59.000Z",
      status: "current"
    });
    expect(result.normalizedResourceCounts).toEqual({
      companyInfo: 1,
      accounts: 2,
      journalEntries: 1,
      ledgerEntries: 1,
      ledgerTransactions: 0,
      ledgerPostings: 2,
      customers: 1,
      vendors: 1,
      items: 1,
      departments: 1,
      classes: 0,
      dimensions: 1,
      parties: 0,
      providerReports: 0,
      reconciliationEvidence: 0
    });
    expect(result.canonicalRowCounts).toEqual({
      companies: 1,
      sources: 1,
      importBatches: 1,
      checkpoints: 1,
      accounts: 2,
      parties: 2,
      items: 1,
      dimensions: 1,
      transactions: 1,
      transactionLines: 2,
      postings: 2
    });
    expect(result.reportStatuses).toEqual({
      profit_and_loss: "generated",
      balance_sheet: "generated",
      trial_balance: "generated",
      cash_flow: "supported"
    });
    expect(Object.keys(result.reports).sort()).toEqual(["balance_sheet", "cash_flow", "profit_and_loss", "trial_balance"]);
    expect(Object.values(result.reports).map((report) => report.freshnessStatus)).toEqual(["fresh", "fresh", "fresh", "fresh"]);
    expect(Object.values(result.reports).map((report) => report.freshnessRowsWritten)).toEqual([1, 1, 1, 1]);
    expect(result.snapshotIds).toEqual({
      profit_and_loss: result.reports.profit_and_loss.snapshotId,
      balance_sheet: result.reports.balance_sheet.snapshotId,
      trial_balance: result.reports.trial_balance.snapshotId,
      cash_flow: result.reports.cash_flow.snapshotId
    });
    expect(result.freshnessIds).toEqual({
      profit_and_loss: result.reports.profit_and_loss.freshnessId,
      balance_sheet: result.reports.balance_sheet.freshnessId,
      trial_balance: result.reports.trial_balance.freshnessId,
      cash_flow: result.reports.cash_flow.freshnessId
    });
    expect(result.parityStatuses).toEqual({
      profit_and_loss: "mismatched",
      balance_sheet: "mismatched",
      trial_balance: "mismatched",
      cash_flow: "unsupported"
    });
    expect(result.providerParity.status).toBe("mismatched");
    expect(result.providerParity.reports.map((report) => [report.reportName, report.status, report.evidenceTotalCount])).toEqual([
      ["profit_and_loss", "mismatched", 3],
      ["balance_sheet", "mismatched", 3],
      ["trial_balance", "mismatched", 3],
      ["cash_flow", "unsupported", 0]
    ]);
    expect(Object.values(result.safeDrilldownRefs).every((refs) => refs.lineRefs.length <= 4 && refs.totalRefs.length <= 4)).toBe(true);
    expect(result.safeDrilldownRefs.profit_and_loss.totalRefs[0]?.refId).toContain("profit_and_loss");
    expect(JSON.stringify(result)).not.toMatch(
      /access[_-]?token|refresh[_-]?token|client[_-]?secret|clientSecret|credential|rawPayload|rawProviderPayload/i
    );
    assertNoCredentialKeys(result);
    expect(replayEvidenceHash(result)).toBe(EXPECTED_REPLAY_EVIDENCE_HASH);
  });

  it("writes canonical facts, report snapshots, and freshness in order with repeatable replay ids", async () => {
    const client = new RecordingReplayPostgresClient();
    const recorded = recordReplayStorage(createPostgresStorageAdapter(client));

    const first = await runFutureErpQuickBooksSandboxReplay({ postgresStorage: recorded.storage });
    const firstCalls = recorded.calls.slice();
    const firstQueryTables = writeQueryTables(client.calls);
    const firstQueryCount = client.calls.length;

    const second = await runFutureErpQuickBooksSandboxReplay({ postgresStorage: recorded.storage });
    const secondCalls = recorded.calls.slice(firstCalls.length);
    const secondQueryTables = writeQueryTables(client.calls.slice(firstQueryCount));

    expect(writeEntities(firstCalls)).toEqual(EXPECTED_REPLAY_WRITE_ENTITIES);
    expect(writeEntities(secondCalls)).toEqual(EXPECTED_REPLAY_WRITE_ENTITIES);
    expect(secondCalls.map(callIdentity)).toEqual(firstCalls.map(callIdentity));
    expect(secondQueryTables).toEqual(firstQueryTables);
    expect(firstQueryTables).toEqual([
      "accounting_companies",
      "accounting_sources",
      "import_batches",
      "sync_checkpoints",
      "accounts",
      "parties",
      "items",
      "accounting_dimensions",
      "transactions",
      "transaction_lines",
      "ledger_postings",
      ...REPORT_NAMES.flatMap(() => [
        "report_snapshots",
        "report_snapshot_lines",
        "report_snapshot_totals",
        "report_snapshot_lines",
        "report_snapshot_totals",
        "report_freshness"
      ])
    ]);
    expect(insertQueries(client.calls).every((call) => call.sql.includes("on conflict"))).toBe(true);
    expect(first.snapshotIds).toEqual(second.snapshotIds);
    expect(first.freshnessIds).toEqual(second.freshnessIds);
    expect(first.snapshotIds).toEqual({
      profit_and_loss:
        "snapshot:tenant_qbo_sync_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      balance_sheet: "snapshot:tenant_qbo_sync_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      trial_balance: "snapshot:tenant_qbo_sync_fixture:trial_balance:accrual:2026-01-01:2026-01-31:2026-01-31:USD",
      cash_flow: "snapshot:tenant_qbo_sync_fixture:cash_flow:accrual:2026-01-01:2026-01-31:2026-01-31:USD"
    });
    expect(first.freshnessIds).toEqual({
      profit_and_loss:
        "freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:profit_and_loss:accrual:2026-01-01:2026-01-31:USD",
      balance_sheet:
        "freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:balance_sheet:accrual:2026-01-01:2026-01-31:USD",
      trial_balance:
        "freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:trial_balance:accrual:2026-01-01:2026-01-31:USD",
      cash_flow:
        "freshness:tenant_qbo_sync_fixture:company_future_erp_qbo_fixture:source_qbo_sync_fixture:cash_flow:accrual:2026-01-01:2026-01-31:USD"
    });
  });
});

class RecordingReplayPostgresClient implements PostgresQueryClient {
  readonly calls: QueryCall[] = [];

  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });

    return Promise.resolve({
      rows: [],
      rowCount: null
    });
  }
}

function recordReplayStorage(base: PostgresStorageAdapter): {
  readonly storage: PostgresStorageAdapter;
  readonly calls: ReplayStorageCall[];
} {
  const calls: ReplayStorageCall[] = [];
  const storage: PostgresStorageAdapter = {
    ...base,
    async upsertAccountingCompany(...args) {
      calls.push({ method: "upsertAccountingCompany", entity: "companies", ids: [args[0].companyId] });
      return base.upsertAccountingCompany(...args);
    },
    async upsertAccountingSource(...args) {
      calls.push({ method: "upsertAccountingSource", entity: "sources", ids: [args[0].sourceId] });
      return base.upsertAccountingSource(...args);
    },
    async upsertImportBatch(...args) {
      calls.push({ method: "upsertImportBatch", entity: "import_batches", ids: [args[0].importBatchId] });
      return base.upsertImportBatch(...args);
    },
    async upsertSyncCheckpoint(...args) {
      calls.push({ method: "upsertSyncCheckpoint", entity: "checkpoints", ids: [args[0].checkpointId] });
      return base.upsertSyncCheckpoint(...args);
    },
    async upsertAccounts(...args) {
      calls.push({ method: "upsertAccounts", entity: "accounts", ids: args[0].map((account) => account.accountId) });
      return base.upsertAccounts(...args);
    },
    async upsertParties(...args) {
      calls.push({ method: "upsertParties", entity: "parties", ids: args[0].map((party) => party.partyId) });
      return base.upsertParties(...args);
    },
    async upsertItems(...args) {
      calls.push({ method: "upsertItems", entity: "items", ids: args[0].map((item) => item.itemId) });
      return base.upsertItems(...args);
    },
    async upsertDimensions(...args) {
      calls.push({ method: "upsertDimensions", entity: "dimensions", ids: args[0].map((dimension) => dimension.dimensionId) });
      return base.upsertDimensions(...args);
    },
    async upsertTransactions(...args) {
      calls.push({
        method: "upsertTransactions",
        entity: "transactions",
        ids: args[0].map((transaction) => transaction.transactionId)
      });
      return base.upsertTransactions(...args);
    },
    async upsertTransactionLines(...args) {
      calls.push({
        method: "upsertTransactionLines",
        entity: "transaction_lines",
        ids: args[0].map((line) => line.transactionLineId)
      });
      return base.upsertTransactionLines(...args);
    },
    async upsertLedgerPostings(...args) {
      calls.push({ method: "upsertLedgerPostings", entity: "postings", ids: args[0].map((posting) => posting.postingId) });
      return base.upsertLedgerPostings(...args);
    },
    async writeReportSnapshot(...args) {
      calls.push({
        method: "writeReportSnapshot",
        entity: "report_snapshots",
        ids: [args[0].snapshot.reportSnapshotId],
        lineIds: args[0].lines.map((line) => line.reportLineId),
        totalIds: args[0].totals.map((total) => total.reportTotalId)
      });
      return base.writeReportSnapshot(...args);
    },
    async writeFreshnessRows(...args) {
      calls.push({ method: "writeFreshnessRows", entity: "freshness", ids: args[0].map((row) => row.freshnessId) });
      return base.writeFreshnessRows(...args);
    }
  };

  return { storage, calls };
}

function writeEntities(calls: readonly ReplayStorageCall[]): readonly ReplayWriteEntity[] {
  return calls.flatMap((call) =>
    call.method === "writeReportSnapshot" ? ["report_snapshots", "snapshot_lines", "snapshot_totals"] : [call.entity]
  );
}

function callIdentity(call: ReplayStorageCall): ReplayStorageCall {
  return {
    method: call.method,
    entity: call.entity,
    ids: call.ids,
    ...(call.lineIds === undefined ? {} : { lineIds: call.lineIds }),
    ...(call.totalIds === undefined ? {} : { totalIds: call.totalIds })
  };
}

function insertQueries(calls: readonly QueryCall[]): readonly QueryCall[] {
  return calls.filter((call) => call.sql.trimStart().startsWith("insert into "));
}

function writeQueryTables(calls: readonly QueryCall[]): readonly string[] {
  return calls
    .filter((call) => call.sql.trimStart().startsWith("insert into ") || call.sql.trimStart().startsWith("delete from "))
    .map((call) => {
      const match = /(?:insert into|delete from) "erp_financials"\."([^"]+)"/u.exec(call.sql);
      if (match?.[1] === undefined) {
        throw new Error(`could not read table name from SQL: ${call.sql}`);
      }
      return match[1];
    });
}

function replayEvidenceHash(result: Awaited<ReturnType<typeof runFutureErpQuickBooksSandboxReplay>>): string {
  const evidence = {
    importBatchId: result.importBatchId,
    checkpointId: result.checkpointId,
    sourceIdentity: result.sourceIdentity,
    importBatch: result.importBatch,
    checkpoint: result.checkpoint,
    normalizedResourceCounts: result.normalizedResourceCounts,
    canonicalRowCounts: result.canonicalRowCounts,
    reportStatuses: result.reportStatuses,
    reports: Object.fromEntries(
      REPORT_NAMES.map((reportName) => {
        const report = result.reports[reportName];
        return [
          reportName,
          {
            status: report.status,
            freshnessStatus: report.freshnessStatus,
            reconciliationStatus: report.reconciliationStatus,
            reconciliationDifference: report.reconciliationDifference,
            snapshotId: report.snapshotId,
            freshnessId: report.freshnessId,
            lineCount: report.lineCount,
            totalCount: report.totalCount,
            snapshotRowsWritten: report.snapshotRowsWritten,
            freshnessRowsWritten: report.freshnessRowsWritten
          }
        ];
      })
    ),
    snapshotIds: result.snapshotIds,
    freshnessIds: result.freshnessIds,
    parityStatuses: result.parityStatuses,
    providerParity: result.providerParity,
    safeDrilldownRefs: result.safeDrilldownRefs
  };

  return createHash("sha256").update(JSON.stringify(evidence, null, 2)).digest("hex");
}
