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

  it("replays a staged zero-effect BillPayment as voided without creating an active payment", async () => {
    const envelope = fullSyncEnvelope();
    const resources = envelope.normalizedResources;
    const stagedEnvelope = {
      ...envelope,
      normalizedResources: {
        ...resources,
        transactions: (resources?.transactions ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "BillPayment",
          transactionType: "bill_payment",
          amount: 0,
          privateNote: "Voided bill payment"
        })),
        transaction_lines: (resources?.transaction_lines ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "BillPayment",
          transactionType: "bill_payment"
        })),
        ledger_entries: []
      }
    };
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope(stagedEnvelope, adapterOptions());
    expect(adapted.resources.operationalDocuments?.[0]).toMatchObject({
      syncAction: "voided",
      resource: {
        sourceTransactionType: "BillPayment",
        totalAmount: "0.00"
      }
    });
    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    const result = await persistQuickBooksSubledgerResources({
      client: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
      companyId: "company_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      facts: mapped.facts,
      resources: adapted.resources
    });
    expect(result.documents).toBe(0);
    expect(result.applications).toBe(0);
  });

  it("projects a zero-cash BillPayment with complete bill and vendor-credit evidence as a direct application", async () => {
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope(fullSyncEnvelope(), adapterOptions());
    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    const resourceTemplate = adapted.resources.operationalDocuments?.[0];
    const transactionTemplate = mapped.facts.transactions[0];
    if (resourceTemplate === undefined || transactionTemplate === undefined) {
      throw new Error("QuickBooks application-only projection fixture requires a document and transaction template.");
    }
    const bill = {
      ...resourceTemplate,
      resourceId: "bill_1822",
      resource: {
        ...resourceTemplate.resource,
        sourceTransactionId: "bill_1822",
        sourceTransactionType: "Bill",
        totalAmount: "125.00",
        openAmount: "0.00",
        unappliedAmount: "0.00",
        lines: []
      }
    };
    const vendorCredit = {
      ...resourceTemplate,
      resourceId: "vendor_credit_1822",
      resource: {
        ...resourceTemplate.resource,
        sourceTransactionId: "vendor_credit_1822",
        sourceTransactionType: "VendorCredit",
        totalAmount: "125.00",
        openAmount: "0.00",
        unappliedAmount: "0.00",
        lines: []
      }
    };
    const applicationOnlyBillPayment = {
      ...resourceTemplate,
      resourceId: "1822",
      resource: {
        ...resourceTemplate.resource,
        sourceTransactionId: "1822",
        sourceTransactionType: "BillPayment",
        totalAmount: "0.00",
        openAmount: "0.00",
        unappliedAmount: "0.00",
        lines: [
          {
            ...resourceTemplate.resource.lines[0],
            sourceLineId: "credit-line",
            lineNumber: 1,
            sourceAmount: "125.00",
            linkedTransactions: [{
              sourceTransactionId: "vendor_credit_1822",
              sourceTransactionType: "VendorCredit"
            }],
            postings: []
          },
          {
            ...resourceTemplate.resource.lines[0],
            sourceLineId: "bill-line",
            lineNumber: 2,
            sourceAmount: "125.00",
            linkedTransactions: [{ sourceTransactionId: "bill_1822", sourceTransactionType: "Bill" }],
            postings: []
          }
        ]
      }
    };
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const result = await persistQuickBooksSubledgerResources({
      client: {
        query(sql, params = []) {
          calls.push({ sql, params });
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
      },
      companyId: "company_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      facts: {
        ...mapped.facts,
        transactions: [
          {
            ...transactionTemplate,
            transactionId: "transaction_bill_1822",
            sourceTransactionId: "bill_1822",
            sourceTransactionType: "Bill"
          },
          {
            ...transactionTemplate,
            transactionId: "transaction_vendor_credit_1822",
            sourceTransactionId: "vendor_credit_1822",
            sourceTransactionType: "VendorCredit"
          }
        ]
      },
      resources: {
        ...adapted.resources,
        operationalDocuments: [bill, vendorCredit, applicationOnlyBillPayment]
      }
    });

    expect(result.documents).toBe(2);
    expect(result.applications).toBe(1);
    const applicationInsert = calls.find((call) =>
      call.sql.includes("'vendor_credit_to_bill'") &&
      call.sql.includes('insert into "erp_financials"."subledger_applications"')
    );
    expect(applicationInsert?.params.slice(4, 9)).toEqual([
      expect.stringMatching(/^qbo_document_/),
      expect.stringMatching(/^qbo_document_/),
      "125.00",
      "USD",
      "2026-08-13"
    ]);
  });

  it("fails an ambiguous zero-total BillPayment with structured safe diagnostics", async () => {
    const envelope = fullSyncEnvelope();
    const resources = envelope.normalizedResources;
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope({
      ...envelope,
      normalizedResources: {
        ...resources,
        transactions: (resources?.transactions ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "BillPayment",
          transactionType: "bill_payment",
          amount: 0,
          privateNote: undefined
        })),
        transaction_lines: (resources?.transaction_lines ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "BillPayment",
          transactionType: "bill_payment"
        })),
        ledger_entries: []
      }
    }, adapterOptions());
    expect(adapted.resources.operationalDocuments?.[0]?.syncAction).toBeUndefined();
    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });

    await expect(persistQuickBooksSubledgerResources({
      client: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
      companyId: "company_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      facts: mapped.facts,
      resources: adapted.resources
    })).rejects.toMatchObject({
      code: "quickbooks_subledger_projection_invalid",
      diagnostic: {
        sourceTransactionType: "BillPayment",
        sourceTransactionId: "payment_700",
        missingBalancedJournal: true,
        totalAmountState: "zero",
        projectionKind: "unclassified_zero_total",
        rejectionReasons: [
          "no_bill_link",
          "no_vendor_credit_link",
          "unsupported_linked_transaction_type"
        ],
        lineCount: 1,
        linkedTransactionCount: 1,
        linkedTransactionTypes: [{ type: "Invoice", count: 1 }],
        nonZeroLineCount: 1,
        unlinkedNonZeroLineCount: 0,
        multiLinkedLineCount: 0,
        missingLinkedAmountCount: 0,
        billLinkedAmountTotal: "0.00",
        vendorCreditLinkedAmountTotal: "0.00",
        otherLinkedAmountTotal: "1250.00",
        missingLinkedTransactionIds: [],
        memoIndicatesVoid: false
      }
    });
  });

  it("accepts parentAccountId as a stable SDK fallback and maps it to the canonical parent id", () => {
    const envelope = fullSyncEnvelope();
    const accounts = (envelope.normalizedResources?.accounts ?? []) as readonly Record<string, unknown>[];
    const hierarchyEnvelope = {
      ...envelope,
      normalizedResources: {
        ...envelope.normalizedResources,
        accounts: accounts.map((account) => account.sourceObjectId === "400"
          ? { ...account, parentAccountId: "100", subAccount: true }
          : account)
      }
    };

    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope(hierarchyEnvelope, adapterOptions());
    expect(adapted.resources.accounts.find((account) => account.resource.sourceAccountId === "400")?.resource)
      .toMatchObject({ parentAccountRef: { sourceObjectId: "100" } });

    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    const parent = mapped.facts.accounts.find((account) => account.sourceAccountId === "100");
    const child = mapped.facts.accounts.find((account) => account.sourceAccountId === "400");
    expect(child?.parentAccountId).toBe(parent?.accountId);
  });

  it("rejects conflicting provider parent fields at the ERP SDK boundary", () => {
    const envelope = fullSyncEnvelope();
    const accounts = (envelope.normalizedResources?.accounts ?? []) as readonly Record<string, unknown>[];
    const malformedEnvelope = {
      ...envelope,
      normalizedResources: {
        ...envelope.normalizedResources,
        accounts: accounts.map((account) => account.sourceObjectId === "400"
          ? { ...account, parentRef: { value: "100" }, parentAccountId: "999", subAccount: true }
          : account)
      }
    };

    expect(() => adaptHandrailQuickBooksSdkFullSyncEnvelope(malformedEnvelope, adapterOptions()))
      .toThrow(/conflicting parentRef\.value and parentAccountId/);
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
      documentLines: 0,
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
          { ...invoiceMetadata("invoice_600:1"), transactionType: "invoice", transactionId: "invoice_600", lineId: "1", lineIndex: 0, lineOrder: 1, amount: 1250, quantity: 5, unitAmount: 250, account: { value: "400", name: "Service Revenue" } }
        ],
        ledger_entries: [
          ...(resources?.ledger_entries ?? []).map((value) => {
            const entry = fixtureResource(value);
            return (
              entry.sourceObject === "Payment" && entry.lineId === "1"
                ? { ...entry, lineId: "derived-ar-1" }
                : entry
            );
          }),
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
      documentLines: 1,
      applications: 1,
      skippedTransactions: 0,
      skippedDocumentLines: 0,
      skippedApplications: 0,
      voidedDocuments: 0,
      removedLedgerPostings: 0,
      unresolvedApplications: []
    });
    expect(calls.filter((sql) => sql.includes('insert into "erp_financials"."subledger_applications"'))).toHaveLength(1);
    expect(calls.some((sql) => sql.includes('set "open_amount" = $5'))).toBe(true);
  });

  it("restores BillPayment LinkedTxn evidence from derived A/P ledger line ids", () => {
    const envelope = fullSyncEnvelope();
    const resources = envelope.normalizedResources;
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope({
      ...envelope,
      normalizedResources: {
        ...resources,
        transactions: (resources?.transactions ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "BillPayment",
          transactionType: "bill_payment"
        })),
        transaction_lines: (resources?.transaction_lines ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "BillPayment",
          transactionType: "bill_payment"
        })),
        ledger_entries: (resources?.ledger_entries ?? []).map((value) => {
          const entry = fixtureResource(value);
          return {
            ...entry,
            sourceObject: "BillPayment",
            transactionType: "bill_payment",
            lineId: entry.lineId === "1" ? "derived-ap-1" : entry.lineId
          };
        })
      }
    }, adapterOptions());

    expect(adapted.resources.ledgerTransactions?.[0]?.resource.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceLineId: "derived-ap-1",
        sourceAmount: "1250.00",
        linkedTransactions: [{ sourceTransactionId: "invoice_600", sourceTransactionType: "Invoice" }]
      })
    ]));
  });

  it("keeps raw QuickBooks bill splits and their customer allocation out of the GL projection", async () => {
    const envelope = fullSyncEnvelope();
    const resources = envelope.normalizedResources;
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope({
      ...envelope,
      normalizedResources: {
        ...resources,
        transactions: (resources?.transactions ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "Bill",
          transactionType: "bill",
          balance: 0,
          party: { value: "vendor_1", name: "TD Synnex" },
          documentNumber: "9662951"
        })),
        transaction_lines: (resources?.transaction_lines ?? []).flatMap((value) => {
          const base = {
            ...fixtureResource(value),
            sourceObject: "Bill",
            transactionType: "bill",
            detailType: "AccountBasedExpenseLineDetail",
            quantity: 1,
            account: { value: "400", name: "Microsoft Office Subscriptions" },
            party: { value: "customer_20", name: "Houchens Industries, Inc." },
            linkedTransactions: []
          };
          return [
            { ...base, amount: 400, unitAmount: 400, description: "NCE Microsoft 365 Business Standard" },
            {
              ...base,
              id: "payment_700:2",
              sourceObjectId: "payment_700:2",
              lineId: "2",
              lineIndex: 1,
              lineOrder: 2,
              amount: 850,
              unitAmount: 850,
              description: "NCE Microsoft 365 Enterprise"
            },
            {
              ...base,
              id: "payment_700:subtotal",
              sourceObjectId: "payment_700:subtotal",
              lineId: "subtotal",
              lineIndex: 2,
              lineOrder: 3,
              detailType: "SubTotalLineDetail",
              amount: 1250,
              account: undefined,
              item: undefined,
              party: undefined,
              description: "Subtotal"
            }
          ];
        }),
        ledger_entries: (resources?.ledger_entries ?? []).map((value, index) => ({
          ...fixtureResource(value),
          sourceObject: "Bill",
          transactionType: "bill",
          lineId: `provider-general-ledger-${String(index + 1)}`,
          party: { value: "vendor_1", name: "TD Synnex" }
        }))
      }
    }, adapterOptions());

    expect(adapted.resources.ledgerTransactions?.[0]?.resource.lines[0]?.postings).not.toHaveLength(0);
    expect(adapted.resources.operationalDocuments?.[0]?.resource).toMatchObject({
      transactionNumber: "9662951",
      openAmount: "0.00",
      lines: [
        {
          sourceLineId: "1",
          detailType: "AccountBasedExpenseLineDetail",
          sourceAmount: "400.00",
          description: "NCE Microsoft 365 Business Standard",
          accountRef: { sourceObjectId: "400" },
          partyRef: {
            sourceObjectId: "customer_20",
            displayName: "Houchens Industries, Inc.",
            partyType: "customer"
          },
          postings: []
        },
        {
          sourceLineId: "2",
          detailType: "AccountBasedExpenseLineDetail",
          sourceAmount: "850.00",
          description: "NCE Microsoft 365 Enterprise",
          postings: []
        },
        {
          sourceLineId: "subtotal",
          detailType: "SubTotalLineDetail",
          sourceAmount: "1250.00",
          description: "Subtotal",
          postings: []
        }
      ]
    });

    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });
    const lineInserts: readonly unknown[][] = [];
    const result = await persistQuickBooksSubledgerResources({
      client: {
        query(sql, params = []) {
          if (sql.includes('insert into "erp_financials"."subledger_document_lines"')) {
            (lineInserts as unknown[][]).push([...params]);
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
      },
      companyId: "company_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      facts: mapped.facts,
      resources: adapted.resources
    });

    expect(lineInserts).toHaveLength(2);
    expect(result.skippedDocumentLines).toBe(1);
    const customerPartyId = mapped.facts.parties.find((party) => party.sourcePartyId === "customer_20")?.partyId;
    expect(lineInserts.map((params) => params[8])).toEqual([customerPartyId, customerPartyId]);
    expect(lineInserts.reduce((sum, params) => sum + Number(params[16]), 0)).toBe(1250);
  });

  it("still fails closed when a posting bill line has no canonical account", async () => {
    const envelope = fullSyncEnvelope();
    const resources = envelope.normalizedResources;
    const adapted = adaptHandrailQuickBooksSdkFullSyncEnvelope({
      ...envelope,
      normalizedResources: {
        ...resources,
        transactions: (resources?.transactions ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "Bill",
          transactionType: "bill",
          party: { value: "vendor_1", name: "Vendor One" }
        })),
        transaction_lines: (resources?.transaction_lines ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "Bill",
          transactionType: "bill",
          detailType: "AccountBasedExpenseLineDetail",
          account: undefined,
          item: undefined
        })),
        ledger_entries: (resources?.ledger_entries ?? []).map((value) => ({
          ...fixtureResource(value),
          sourceObject: "Bill",
          transactionType: "bill"
        }))
      }
    }, adapterOptions());
    const mapped = mapNormalizedQuickBooksFullSyncResponseToCanonicalFacts(adapted, {
      companyId: "company_spartan",
      accountingBasis: "accrual",
      currencyCode: "USD"
    });

    await expect(persistQuickBooksSubledgerResources({
      client: { query: () => Promise.resolve({ rows: [], rowCount: 1 }) },
      companyId: "company_spartan",
      importedAt: "2026-08-13T12:46:00.000Z",
      facts: mapped.facts,
      resources: adapted.resources
    })).rejects.toThrow(/Bill payment_700 line 1 has an amount but no canonical account/);
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

function fixtureResource(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("QuickBooks fixture resource must be an object");
  }
  return value as Record<string, unknown>;
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
