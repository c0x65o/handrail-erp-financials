import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  assertLedgerPostingAmounts,
  assertManifestHasNoCredentialColumns,
  assertNoCredentialKeys,
  assertSafeSourcePayloadRef,
  canonicalSourceIdentityKey,
  createDimensionHash,
  renderPostgresSchemaSql
} from "../src/index.js";

const FUTURE_ERP_CANONICAL_SCHEMA_MIGRATION_SQL = readFileSync(
  new URL("../migrations/future-erp/20260620000000_create_erp_financials_canonical_schema.sql", import.meta.url),
  "utf8"
);

describe("canonical schema manifest", () => {
  it("is versioned and covers the documented canonical entities", () => {
    expect(POSTGRES_CANONICAL_SCHEMA_MANIFEST.manifestVersion).toBe("2026-06-19.storage-v1");
    expect(POSTGRES_CANONICAL_SCHEMA_MANIFEST.schemaVersion).toBe(2);

    const tableNames = POSTGRES_CANONICAL_SCHEMA_MANIFEST.tables.map((table) => table.name);

    expect(tableNames).toEqual([
      "accounting_companies",
      "accounting_sources",
      "accounts",
      "parties",
      "items",
      "accounting_dimensions",
      "transactions",
      "transaction_lines",
      "ledger_postings",
      "rollup_buckets",
      "import_batches",
      "sync_checkpoints",
      "report_freshness",
      "report_snapshots",
      "report_snapshot_lines",
      "report_snapshot_totals"
    ]);
  });

  it("renders deterministic Postgres SQL with idempotency and accounting constraints", () => {
    const firstRender = renderPostgresSchemaSql();
    const secondRender = renderPostgresSchemaSql();

    expect(secondRender).toBe(firstRender);
    expect(firstRender).toContain('create schema if not exists "erp_financials";');
    expect(firstRender).toContain("constraint \"ledger_postings_nonnegative_debit_check\" check (debit_amount >= 0)");
    expect(firstRender).toContain("constraint \"ledger_postings_nonnegative_credit_check\" check (credit_amount >= 0)");
    expect(firstRender).toContain(
      'create unique index if not exists "ledger_postings_source_posting_uidx" on "erp_financials"."ledger_postings" ("tenant_id", "source_id", "accounting_basis", "source_posting_id");'
    );
    expect(firstRender).toContain(
      'create unique index if not exists "rollup_buckets_identity_uidx" on "erp_financials"."rollup_buckets" ("tenant_id", "company_id", "source_id", "accounting_basis", "bucket_grain", "bucket_start", "bucket_end", "account_id", "currency_code", "dimension_hash");'
    );
    expect(firstRender).toContain(
      'create unique index if not exists "report_freshness_identity_uidx" on "erp_financials"."report_freshness" ("tenant_id", "company_id", "source_id", "report_name", "accounting_basis", "period_start", "period_end", "currency_code");'
    );
    expect(firstRender).toContain(
      "constraint \"transactions_source_payload_ref_bounded_json_check\" check (octet_length(coalesce(\"source_payload_ref\"::text, '')) <= 4096)"
    );
  });

  it("keeps credential custody out of financial tables", () => {
    expect(() => {
      assertManifestHasNoCredentialColumns();
    }).not.toThrow();

    for (const table of POSTGRES_CANONICAL_SCHEMA_MANIFEST.tables) {
      expect(table.policies.noRawCredentials).toBe(true);
    }
  });

  it("rejects audited credential and raw payload schema column variants", () => {
    const firstTable = POSTGRES_CANONICAL_SCHEMA_MANIFEST.tables[0];
    if (!firstTable) {
      throw new Error("Expected canonical schema manifest to contain at least one table.");
    }

    const forbiddenColumnNames = [
      "access_token",
      "access-token",
      "accessToken",
      "refresh_token",
      "refresh-token",
      "refreshToken",
      "client_secret",
      "client-secret",
      "clientSecret",
      "credential",
      "private-key",
      "raw_payload",
      "raw-payload",
      "rawPayload",
      "raw_provider_payload",
      "raw-provider-payload",
      "rawProviderPayload",
      "provider-payload-archive",
      "providerPayloadArchive",
      "payload-archive",
      "payloadArchive",
      "raw-archive",
      "rawArchive"
    ];

    for (const columnName of forbiddenColumnNames) {
      expect(() => {
        assertManifestHasNoCredentialColumns({
          ...POSTGRES_CANONICAL_SCHEMA_MANIFEST,
          tables: [
            {
              ...firstTable,
              columns: [...firstTable.columns, { name: columnName, type: "text" }]
            }
          ]
        });
      }).toThrow("credential-like column is not allowed");
    }
  });

  it("keeps the Future ERP migration aligned to the canonical Postgres renderer", () => {
    expect(FUTURE_ERP_CANONICAL_SCHEMA_MIGRATION_SQL).toBe(renderPostgresSchemaSql(POSTGRES_CANONICAL_SCHEMA_MANIFEST));
    expect(FUTURE_ERP_CANONICAL_SCHEMA_MIGRATION_SQL).not.toMatch(
      /\b(token|secret|credential|password|client_secret|access_token|refresh_token|raw_provider_payload|raw_payload)\b/i
    );
  });
});

describe("canonical model constraints", () => {
  it("rejects negative debit or credit amounts", () => {
    expect(() => {
      assertLedgerPostingAmounts({
        debitAmount: "0",
        creditAmount: "12.34"
      });
    }).not.toThrow();

    expect(() => {
      assertLedgerPostingAmounts({
        debitAmount: "-0.01",
        creditAmount: "0"
      });
    }).toThrow("debitAmount must be a nonnegative decimal string");
  });

  it("builds tenant-scoped idempotent source identity keys", () => {
    expect(
      canonicalSourceIdentityKey({
        tenantId: "tenant_1",
        sourceId: "source_1",
        sourceSystem: "quickbooks",
        providerEnvironment: "sandbox",
        sourceObjectType: "Invoice",
        sourceObjectId: "123"
      })
    ).toBe("tenant_1:source_1:quickbooks:sandbox:Invoice:123");
  });

  it("enforces bounded safe source payload refs with no credential-like fields", () => {
    expect(() => {
      assertSafeSourcePayloadRef({
        sourceObjectType: "Invoice",
        sourceObjectId: "123",
        byteLength: 128,
        checksum: "sha256:abc",
        preview: {
          txnDate: "2026-01-31"
        }
      });
    }).not.toThrow();

    expect(() => {
      assertSafeSourcePayloadRef({
        sourceObjectType: "Invoice",
        sourceObjectId: "123",
        byteLength: 4097
      });
    }).toThrow("sourcePayloadRef.byteLength exceeds 4096 bytes");

    expect(() => {
      assertSafeSourcePayloadRef({
        sourceObjectType: "Invoice",
        sourceObjectId: "123",
        preview: {
          access_token: "not allowed"
        }
      });
    }).toThrow("credential-like field is not allowed");
  });

  it("rejects audited credential and raw provider payload field names", () => {
    const forbiddenKeys = [
      "access_token",
      "access-token",
      "accessToken",
      "refresh_token",
      "refresh-token",
      "refreshToken",
      "client_secret",
      "client-secret",
      "clientSecret",
      "token",
      "secret",
      "password",
      "credential",
      "private_key",
      "private-key",
      "raw_payload",
      "raw-payload",
      "rawPayload",
      "raw_provider_payload",
      "raw-provider-payload",
      "rawProviderPayload",
      "provider-payload-archive",
      "providerPayloadArchive",
      "payload-archive",
      "payloadArchive",
      "raw-archive",
      "rawArchive"
    ];

    for (const key of forbiddenKeys) {
      expect(() => {
        assertNoCredentialKeys({ nested: { [key]: "not allowed" } });
      }).toThrow("credential-like field is not allowed");
    }
  });

  it("creates deterministic dimension hashes independent of input order", () => {
    const firstHash = createDimensionHash([
      {
        dimensionKind: "department",
        sourceDimensionId: "engineering",
        name: "Engineering"
      },
      {
        dimensionKind: "location",
        sourceDimensionId: "chicago",
        name: "Chicago"
      }
    ]);
    const secondHash = createDimensionHash([
      {
        dimensionKind: "location",
        sourceDimensionId: "chicago",
        name: "Chicago"
      },
      {
        dimensionKind: "department",
        sourceDimensionId: "engineering",
        name: "Engineering"
      }
    ]);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toHaveLength(64);
  });
});
