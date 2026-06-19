import { describe, expect, it } from "vitest";

import {
  POSTGRES_CANONICAL_SCHEMA_MANIFEST,
  assertLedgerPostingAmounts,
  assertManifestHasNoCredentialColumns,
  assertSafeSourcePayloadRef,
  canonicalSourceIdentityKey,
  createDimensionHash,
  renderPostgresSchemaSql
} from "../src/index.js";

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
