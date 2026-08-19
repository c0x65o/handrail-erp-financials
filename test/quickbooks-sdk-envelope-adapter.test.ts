import { describe, expect, it } from "vitest";

import {
  adaptHandrailQuickBooksSdkFullSyncEnvelope,
  adaptHandrailQuickBooksSdkIncrementalSyncEnvelope,
  assertNoCredentialKeys,
  mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts,
  mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts,
  persistQuickBooksSubledgerResources
} from "../src/index.js";
import type {
  HandrailQuickBooksSdkFullSyncEnvelope,
  HandrailQuickBooksSdkIncrementalSyncEnvelope,
  HandrailQuickBooksSdkNormalizedResourceMap
} from "../src/index.js";

describe("QuickBooks SDK envelope adapter", () => {
  it("adapts a full-sync envelope without losing identity, warnings, completeness, checkpoints, or posting polarity", () => {
    const sdkEnvelope = fullSyncEnvelope();
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope(sdkEnvelope, adapterOptions());

    expect(adapted.sourceIdentity).toEqual({
      tenantId: "tenant_spartan",
      sourceId: "source_spartan_qbo",
      sourceSystem: "quickbooks",
      providerEnvironment: "sandbox",
      realmId: "realm_spartan",
      sourceCompanyRef: "realm_spartan"
    });
    expect(adapted.checkpoint).toMatchObject({
      checkpointId: "checkpoint_full_spartan",
      cursorKind: "full_scan",
      cursorValue: "2026-08-13T12:45:00.000Z",
      latestSourceUpdatedAt: "2026-08-13T12:45:00.000Z",
      status: "current"
    });
    expect(adapted.normalizedCompleteness).toEqual(sdkEnvelope.normalizedCompleteness);
    expect(adapted.normalizationWarnings).toEqual(sdkEnvelope.normalizationWarnings);
    expect(adapted.deltaCounts).toEqual(sdkEnvelope.deltaCounts);
    expect(adapted.warningSummary?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "quickbooks_posting_fallback",
          resourceId: "payment_700",
          severity: "warning"
        }),
        expect.objectContaining({
          code: "quickbooks_normalized_ledger_entries_incomplete",
          resourceType: "ledger_entries",
          severity: "warning"
        })
      ])
    );

    const ledgerTransaction = adapted.resources.ledgerTransactions?.[0];
    expect(ledgerTransaction?.syncAction).toBeUndefined();
    expect(ledgerTransaction?.resource.lines[0]?.postings[0]).toMatchObject({
      debitAmount: "1250.00",
      accountRef: { sourceObjectId: "100" }
    });
    expect(ledgerTransaction?.resource.lines[1]?.postings[0]).toMatchObject({
      creditAmount: "1250.00",
      accountRef: { sourceObjectId: "400" }
    });
    expect(ledgerTransaction?.resource).toMatchObject({
      totalAmount: "1250.00",
      unappliedAmount: "250.00",
      partyRef: { sourceObjectId: "customer_20", partyType: "customer" }
    });
    expect(ledgerTransaction?.resource.lines[0]?.linkedTransactions).toEqual([
      { sourceTransactionId: "invoice_600", sourceTransactionType: "Invoice" }
    ]);
    expect(ledgerTransaction?.resource.lines[0]).toMatchObject({
      sourceAmount: "1250.00",
      sourceQuantity: "5.00",
      sourceUnitAmount: "250.00",
      taxCode: "NON"
    });

    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    expect(mapped.facts.postings.map((posting) => [posting.debitAmount, posting.creditAmount])).toEqual([
      ["1250.00", "0.00"],
      ["0.00", "1250.00"]
    ]);
    expect(mapped.facts.importBatch.status).toBe("completed_with_warnings");
    expect(mapped.facts.checkpoint.checkpointId).toBe("checkpoint_full_spartan");
    expect(() => {
      assertNoCredentialKeys(adapted);
    }).not.toThrow();
  });

  it("adapts incremental resources with changed actions and resumable checkpoint evidence", () => {
    const sdkEnvelope = incrementalSyncEnvelope();
    const adapted = adaptHandrailQuickBooksSdkIncrementalSyncEnvelope(sdkEnvelope, adapterOptions());

    expect(adapted.syncMode).toBe("incremental");
    expect(adapted.cursorKind).toBe("updated_since");
    expect(adapted.cursorValue).toBe("2026-08-13T13:00:00.000Z");
    expect(adapted.resources.accounts?.every((resource) => resource.syncAction === "changed")).toBe(true);
    expect(adapted.resources.ledgerTransactions?.every((resource) => resource.syncAction === "changed")).toBe(true);

    const mapped = mapNormalizedQuickBooksIncrementalSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD",
      resumeFromCheckpointId: "checkpoint_full_spartan"
    });
    expect(mapped.resumeFromCheckpointId).toBe("checkpoint_full_spartan");
    expect(mapped.changedResourceActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceType: "Account", resourceId: "100", action: "changed" }),
        expect.objectContaining({ resourceType: "LedgerTransaction", resourceId: "payment_700", action: "changed" })
      ])
    );
    expect(mapped.facts.checkpoint).toMatchObject({
      checkpointId: "checkpoint_incremental_spartan",
      cursorKind: "updated_since",
      cursorValue: "2026-08-13T13:00:00.000Z"
    });
  });

  it("persists adapted QuickBooks operational documents without inventing unresolved applications", async () => {
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope(fullSyncEnvelope(), adapterOptions());
    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    const calls: string[] = [];
    const result = await persistQuickBooksSubledgerResources({
      client: {
        query(sql) {
          calls.push(sql);
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
      },
      companyId: "company_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      facts: mapped.facts,
      resources: adapted.resources
    });

    expect(result).toEqual({
      documents: 1,
      documentLines: 1,
      applications: 0,
      skippedTransactions: 0,
      skippedDocumentLines: 0,
      skippedApplications: 1,
      voidedDocuments: 0,
      removedLedgerPostings: 0,
      unresolvedApplications: [expect.objectContaining({ reason: "missing_target_document" })]
    });
    expect(calls.some((sql) => sql.includes('"subledger_documents"'))).toBe(true);
    expect(calls.some((sql) => sql.includes('insert into "erp_financials"."subledger_applications"'))).toBe(false);
  });

  it("turns QuickBooks LinkedTxn evidence into a canonical payment application", async () => {
    const envelope = fullSyncEnvelope();
    const resources = envelope.normalizedResources;
    const invoiceMetadata = (id: string) => ({
      id,
      tenantId: "tenant_spartan",
      realmId: "realm_spartan",
      companyId: "realm_spartan",
      provider: "intuit" as const,
      providerEnvironment: "sandbox" as const,
      source: "quickbooks_accounting_api" as const,
      sourceObject: "Invoice",
      sourceObjectId: id,
      importBatchId: "batch_full_spartan",
      jobId: "job_full_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      syncedAt: "2026-08-13T12:46:00.000Z",
      sourceUpdatedAt: "2026-08-13T12:45:00.000Z",
      audit: { sourcePayloadRef: `raw://batch_full_spartan/Invoice/${id}` }
    });
    const linkedEnvelope = {
      ...envelope,
      normalizedResources: {
        ...resources,
        accounts: [
          ...(resources?.accounts ?? []),
          { ...invoiceMetadata("110"), sourceObject: "Account", name: "Accounts Receivable", accountType: "Accounts Receivable", classification: "Asset", active: true }
        ],
        transactions: [
          ...(resources?.transactions ?? []),
          { ...invoiceMetadata("invoice_600"), transactionType: "invoice", transactionDate: "2026-08-01", dueDate: "2026-08-31", amount: 1250, balance: 0, party: { value: "customer_20", name: "Acme" }, documentNumber: "INV-600" }
        ],
        transaction_lines: [
          ...(resources?.transaction_lines ?? []),
          { ...invoiceMetadata("invoice_600:1"), transactionType: "invoice", transactionId: "invoice_600", lineId: "1", lineIndex: 0, lineOrder: 1, amount: 1250, quantity: 5, unitAmount: 250 }
        ],
        ledger_entries: [
          ...(resources?.ledger_entries ?? []),
          { ...invoiceMetadata("invoice_600:1"), transactionId: "invoice_600", transactionType: "invoice", lineId: "1", transactionDate: "2026-08-01", postingType: "Credit", amount: 1250, account: { value: "400", name: "Service Revenue" }, party: { value: "customer_20", name: "Acme" }, currency: { value: "USD" } },
          { ...invoiceMetadata("invoice_600:ar"), transactionId: "invoice_600", transactionType: "invoice", lineId: "derived-ar-offset", transactionDate: "2026-08-01", postingType: "Debit", amount: 1250, account: { value: "110", name: "Accounts Receivable" }, party: { value: "customer_20", name: "Acme" }, currency: { value: "USD" } }
        ]
      }
    };
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope(linkedEnvelope, adapterOptions());
    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    const calls: string[] = [];
    const result = await persistQuickBooksSubledgerResources({
      client: { query(sql) { calls.push(sql); return Promise.resolve({ rows: [], rowCount: 1 }); } },
      companyId: "company_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      facts: mapped.facts,
      resources: adapted.resources
    });

    expect(result).toEqual({
      documents: 2,
      documentLines: 2,
      applications: 1,
      skippedTransactions: 0,
      skippedDocumentLines: 0,
      skippedApplications: 0,
      voidedDocuments: 0,
      removedLedgerPostings: 0,
      unresolvedApplications: []
    });
    expect(calls.filter((sql) => sql.includes('insert into "erp_financials"."subledger_applications"'))).toHaveLength(1);
  });

  it("fails closed when SDK resource identity differs from the envelope", () => {
    const sdkEnvelope = fullSyncEnvelope({ resourceTenantId: "tenant_other" });

    expect(() => adaptHandrailQuickBooksSdkFullSyncEnvelope(sdkEnvelope, adapterOptions())).toThrow(
      /resource identity does not match tenant tenant_spartan/
    );
  });

  it("requires explicit Debit or Credit polarity for every ledger posting", () => {
    const sdkEnvelope = fullSyncEnvelope({ postingType: "Unknown" });

    expect(() => adaptHandrailQuickBooksSdkFullSyncEnvelope(sdkEnvelope, adapterOptions())).toThrow(
      /invalid postingType Unknown; expected Debit or Credit/
    );
  });

  it("preserves negative posting polarity and omits zero-value ledger rows", () => {
    const sdkEnvelope = fullSyncEnvelope({ firstAmount: 0, secondAmount: -1250 });

    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope(sdkEnvelope, adapterOptions());
    const lines = adapted.resources.ledgerTransactions?.[0]?.resource.lines;

    expect(lines).toHaveLength(1);
    expect(lines?.[0]?.postings).toEqual([
      expect.objectContaining({
        debitAmount: "1250.00",
        accountRef: { sourceObjectId: "400", displayName: "Service Revenue" }
      })
    ]);

    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    expect(mapped.facts.postings.map((posting) => [posting.debitAmount, posting.creditAmount])).toEqual([
      ["1250.00", "0.00"]
    ]);
  });
});

function adapterOptions() {
  return {
    sourceId: "source_spartan_qbo",
    accountingBasis: "accrual" as const,
    currencyCode: "USD",
    companyDisplayName: "Spartan Cyber"
  };
}

function fullSyncEnvelope(
  overrides: {
    readonly resourceTenantId?: string;
    readonly postingType?: string;
    readonly firstAmount?: number;
    readonly secondAmount?: number;
  } = {}
): HandrailQuickBooksSdkFullSyncEnvelope {
  return {
    contractId: "handrail.quickbooks.normalized-sync-envelope.v1",
    syncMode: "full",
    tenantId: "tenant_spartan",
    companyId: "realm_spartan",
    importBatchId: "batch_full_spartan",
    jobId: "job_full_spartan",
    status: "succeeded",
    normalizedResourceCounts: { accounts: 2, ledger_entries: 2 },
    normalizedResources: normalizedResources(overrides),
    normalizedCompleteness: {
      accounts: {
        resourceFamily: "accounts",
        complete: true,
        status: "complete",
        normalizedRecordCount: 2,
        reason: "All account pages completed."
      },
      ledger_entries: {
        resourceFamily: "ledger_entries",
        complete: false,
        status: "incomplete",
        normalizedRecordCount: 2,
        reason: "One tax detail row could not be assigned to an account."
      }
    },
    normalizationWarnings: [
      {
        code: "quickbooks_posting_fallback",
        objectType: "Payment",
        transactionId: "payment_700",
        message: "A bounded posting fallback was used."
      }
    ],
    deltaCounts: {
      skippedCount: 0,
      changedCount: 2,
      insertedCount: 2,
      failedCount: 0,
      unchangedCount: 0,
      updatedCount: 0
    },
    audit: {
      checkpointId: "checkpoint_full_spartan",
      importBatchId: "batch_full_spartan",
      jobId: "job_full_spartan",
      realmId: "realm_spartan",
      sourcePayloadRef: "raw://batch_full_spartan"
    },
    importVolume: { entityCounts: { accounts: 2, ledger_entries: 2 } },
    importBatch: {
      startedAt: "2026-08-13T12:40:00.000Z",
      completedAt: "2026-08-13T12:46:00.000Z",
      realmId: "realm_spartan",
      status: "succeeded"
    },
    checkpoint: {
      checkpointId: "checkpoint_full_spartan",
      checkpointRef: "checkpoint://quickbooks/tenant_spartan/checkpoint_full_spartan",
      completedAt: "2026-08-13T12:46:00.000Z",
      entity: "ledger_entries",
      providerUpdatedAtWatermark: "2026-08-13T12:45:00.000Z",
      startedAt: "2026-08-13T12:40:00.000Z",
      status: "succeeded"
    },
    syncJob: {
      startedAt: "2026-08-13T12:40:00.000Z",
      completedAt: "2026-08-13T12:46:00.000Z",
      audit: { sourcePayloadRef: "raw://batch_full_spartan/sync-jobs/job_full_spartan" }
    }
  };
}

function incrementalSyncEnvelope(): HandrailQuickBooksSdkIncrementalSyncEnvelope {
  const full = fullSyncEnvelope();
  const checkpoint = full.checkpoint;
  if (checkpoint === undefined) {
    throw new Error("Full-sync fixture checkpoint is required.");
  }
  return {
    ...full,
    syncMode: "incremental",
    importBatchId: "batch_incremental_spartan",
    jobId: "job_incremental_spartan",
    normalizedResources: normalizedResources({
      importBatchId: "batch_incremental_spartan",
      jobId: "job_incremental_spartan"
    }),
    audit: {
      ...full.audit,
      checkpointId: "checkpoint_incremental_spartan",
      importBatchId: "batch_incremental_spartan",
      jobId: "job_incremental_spartan"
    },
    importBatch: {
      ...full.importBatch,
      startedAt: "2026-08-13T13:00:00.000Z",
      completedAt: "2026-08-13T13:01:00.000Z"
    },
    checkpoint: {
      ...checkpoint,
      checkpointId: "checkpoint_incremental_spartan",
      checkpointRef: "checkpoint://quickbooks/tenant_spartan/checkpoint_incremental_spartan",
      completedAt: "2026-08-13T13:01:00.000Z",
      providerUpdatedAtWatermark: "2026-08-13T13:00:00.000Z"
    },
    syncJob: {
      ...full.syncJob,
      startedAt: "2026-08-13T13:00:00.000Z",
      completedAt: "2026-08-13T13:01:00.000Z"
    }
  };
}

function normalizedResources(overrides: {
  readonly importBatchId?: string;
  readonly jobId?: string;
  readonly resourceTenantId?: string;
  readonly postingType?: string;
  readonly firstAmount?: number;
  readonly secondAmount?: number;
}): HandrailQuickBooksSdkNormalizedResourceMap {
  const importBatchId = overrides.importBatchId ?? "batch_full_spartan";
  const jobId = overrides.jobId ?? "job_full_spartan";
  const metadata = (input: { readonly id: string; readonly sourceObject: string }) => ({
    id: input.id,
    sourceObject: input.sourceObject,
    sourceObjectId: input.id,
    tenantId: overrides.resourceTenantId ?? "tenant_spartan",
    realmId: "realm_spartan",
    companyId: "realm_spartan",
    provider: "intuit",
    providerEnvironment: "sandbox",
    source: "quickbooks_accounting_api",
    importBatchId,
    jobId,
    importedAt: "2026-08-13T12:46:00.000Z",
    syncedAt: "2026-08-13T12:46:00.000Z",
    sourceUpdatedAt: "2026-08-13T12:45:00.000Z",
    audit: {
      checkpointId: "checkpoint_full_spartan",
      sourcePayloadRef: `raw://${importBatchId}/${input.sourceObject}/${input.id}`
    }
  });

  return {
    accounts: [
      {
        ...metadata({ id: "100", sourceObject: "Account" }),
        name: "Operating Cash",
        accountType: "Bank",
        classification: "Asset",
        active: true,
        currency: { value: "USD" }
      },
      {
        ...metadata({ id: "400", sourceObject: "Account" }),
        name: "Service Revenue",
        accountType: "Income",
        classification: "Income",
        active: true,
        currency: { value: "USD" }
      }
    ],
    ledger_entries: [
      {
        ...metadata({ id: "ledger_payment_700_1", sourceObject: "Payment" }),
        transactionId: "payment_700",
        transactionType: "payment",
        lineId: "1",
        transactionDate: "2026-08-13",
        postingType: overrides.postingType ?? "Debit",
        amount: overrides.firstAmount ?? 1250,
        account: { value: "100", name: "Operating Cash" },
        currency: { value: "USD" }
      },
      {
        ...metadata({ id: "ledger_payment_700_2", sourceObject: "Payment" }),
        transactionId: "payment_700",
        transactionType: "payment",
        lineId: "2",
        transactionDate: "2026-08-13",
        postingType: "Credit",
        amount: overrides.secondAmount ?? 1250,
        account: { value: "400", name: "Service Revenue" },
        currency: { value: "USD" }
      }
    ],
    transactions: [
      {
        ...metadata({ id: "payment_700", sourceObject: "Payment" }),
        transactionType: "payment",
        transactionDate: "2026-08-13",
        amount: 1250,
        unappliedAmount: 250,
        party: { value: "customer_20", name: "Acme" },
        documentNumber: "PAY-700"
      }
    ],
    transaction_lines: [
      {
        ...metadata({ id: "payment_700:1", sourceObject: "Payment" }),
        transactionType: "payment",
        transactionId: "payment_700",
        lineId: "1",
        lineIndex: 0,
        lineOrder: 1,
        amount: 1250,
        quantity: 5,
        unitAmount: 250,
        taxCode: { value: "NON", name: "Non-taxable" },
        linkedTransactions: [{ transactionId: "invoice_600", transactionType: "Invoice" }]
      }
    ]
  };
}
