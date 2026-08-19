import { createHash } from "node:crypto";

import type { JsonValue } from "./canonical-model.js";
import type { PostgresQueryClient } from "./postgres-storage.js";
import type { CanonicalAccountingFactSet } from "./source-adapters.js";
import type { HandrailQuickBooksSdkResourceSet } from "./source-adapters.js";

type ImportedDocumentType =
  | "invoice"
  | "customer_payment"
  | "credit_memo"
  | "refund"
  | "vendor_bill"
  | "bill_payment"
  | "deposit"
  | "transfer"
  | "sales_receipt"
  | "purchase"
  | "vendor_credit";

type ImportedApplicationType =
  | "customer_payment_to_invoice"
  | "bill_payment_to_bill"
  | "credit_to_invoice"
  | "vendor_credit_to_bill";

export type QuickBooksSubledgerImportResult = {
  readonly documents: number;
  readonly documentLines: number;
  readonly applications: number;
  readonly skippedTransactions: number;
  readonly skippedDocumentLines: number;
  readonly skippedApplications: number;
  readonly voidedDocuments: number;
  readonly removedLedgerPostings: number;
  readonly unresolvedApplications: readonly {
    readonly sourceTransactionId: string;
    readonly targetSourceTransactionId: string;
    readonly sourceLineId: string;
    readonly reason: "missing_target_document" | "missing_positive_amount";
  }[];
};

export type PersistQuickBooksSubledgerResourcesInput = {
  readonly companyId: string;
  readonly importedAt: string;
  readonly facts: CanonicalAccountingFactSet;
  readonly resources: HandrailQuickBooksSdkResourceSet;
  /** Treat the supplied operational documents as the complete provider snapshot. */
  readonly replaceMissingDocuments?: boolean;
};

export async function persistQuickBooksSubledgerResources(
  input: PersistQuickBooksSubledgerResourcesInput & { readonly client: PostgresQueryClient }
): Promise<QuickBooksSubledgerImportResult> {
  await input.client.query(
    `select set_config('erp_financials.quickbooks_projection_refresh', 'on', true)`
  );
  const transactionBySourceId = new Map(
    input.facts.transactions.map((transaction) => [transaction.sourceTransactionId, transaction])
  );
  const documentIdBySourceId = new Map<string, string>();
  const accountIdBySourceId = new Map(input.facts.accounts.map((account) => [account.sourceAccountId, account.accountId]));
  const itemBySourceId = new Map(input.facts.items.map((item) => [item.sourceItemId, item]));
  const operationalDocuments = input.resources.operationalDocuments ?? input.resources.ledgerTransactions ?? [];
  for (const resource of operationalDocuments) {
    const normalized = resource.resource;
    if (importedDocumentType(normalized.sourceTransactionType) !== undefined) {
      documentIdBySourceId.set(
        normalized.sourceTransactionId,
        stableId("qbo_document", input.facts.source.sourceId, normalized.sourceTransactionType, normalized.sourceTransactionId)
      );
    }
  }
  const existingDocuments = await input.client.query<{
    source_transaction_id: string;
    subledger_document_id: string;
  }>(
    `select "metadata" ->> 'sourceTransactionId' as "source_transaction_id", "subledger_document_id"
from "erp_financials"."subledger_documents"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "metadata" ->> 'provider' = 'quickbooks'`,
    [input.facts.company.tenantId, input.companyId, input.facts.source.sourceId]
  );
  for (const row of existingDocuments.rows) {
    if (row.source_transaction_id && row.subledger_document_id) {
      documentIdBySourceId.set(row.source_transaction_id, row.subledger_document_id);
    }
  }
  let documents = 0;
  let documentLines = 0;
  let skippedTransactions = 0;
  let voidedDocuments = 0;
  let removedLedgerPostings = 0;
  const skippedDocumentLines = 0;

  for (const resource of operationalDocuments) {
    if (resource.syncAction === "voided" || resource.syncAction === "deleted") continue;
    const normalized = resource.resource;
    const documentType = importedDocumentType(normalized.sourceTransactionType);
    if (documentType === undefined) continue;
    const transaction = transactionBySourceId.get(normalized.sourceTransactionId);
    const originalAmount = positiveAmount(normalized.totalAmount);
    if (transaction === undefined || originalAmount === undefined) {
      throw new Error(
        `QuickBooks ${normalized.sourceTransactionType} ${normalized.sourceTransactionId} cannot become a canonical subledger document because its balanced journal or positive total is missing`
      );
    }
    const documentId = documentIdBySourceId.get(normalized.sourceTransactionId);
    if (documentId === undefined) {
      skippedTransactions += 1;
      continue;
    }
    const eventId = stableId("qbo_event", documentId, "imported");
    const idempotencyKey = `quickbooks:subledger:${input.facts.source.sourceId}:${normalized.sourceTransactionType}:${normalized.sourceTransactionId}`;
    const initialState = initialDocumentState(documentType, originalAmount);
    const payload: JsonValue = {
      provider: "quickbooks",
      sourceTransactionId: normalized.sourceTransactionId,
      sourceTransactionType: normalized.sourceTransactionType,
      importBatchId: input.facts.importBatch.importBatchId
    };
    await insertLifecycleEvent(input.client, {
      eventId,
      tenantId: input.facts.company.tenantId,
      companyId: input.companyId,
      sourceId: input.facts.source.sourceId,
      aggregateId: documentId,
      eventType: "quickbooks_document_imported",
      occurredAt: normalized.sourceUpdatedAt ?? input.importedAt,
      recordedAt: input.importedAt,
      idempotencyKey: `${idempotencyKey}:event`,
      payload
    });
    const result = await input.client.query(
      `insert into "erp_financials"."subledger_documents" (
        "subledger_document_id", "tenant_id", "company_id", "source_id", "document_type",
        "transaction_id", "party_id", "document_number", "document_date", "due_date",
        "currency_code", "original_amount", "open_amount", "status", "version",
        "idempotency_key", "lifecycle_event_id", "metadata", "created_at", "updated_at"
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$16,$17::jsonb,$18,$18)
      on conflict ("tenant_id", "company_id", "source_id", "idempotency_key") do update
      set "transaction_id" = excluded."transaction_id",
        "party_id" = excluded."party_id",
        "document_number" = excluded."document_number",
        "document_date" = excluded."document_date",
        "due_date" = excluded."due_date",
        "currency_code" = excluded."currency_code",
        "original_amount" = excluded."original_amount",
        "open_amount" = excluded."original_amount" - (case
          when "subledger_documents"."status" = 'voided' then 0
          else "subledger_documents"."original_amount" - "subledger_documents"."open_amount"
        end),
        "status" = case
          when excluded."status" = 'settled' then 'settled'
          when excluded."original_amount" - (case when "subledger_documents"."status" = 'voided' then 0 else "subledger_documents"."original_amount" - "subledger_documents"."open_amount" end) = 0 then 'settled'
          when excluded."original_amount" - (case when "subledger_documents"."status" = 'voided' then 0 else "subledger_documents"."original_amount" - "subledger_documents"."open_amount" end) = excluded."original_amount" then 'open'
          else 'partially_applied'
        end,
        "version" = "subledger_documents"."version" + 1,
        "metadata" = excluded."metadata",
        "updated_at" = excluded."updated_at"
      where "subledger_documents"."transaction_id" is distinct from excluded."transaction_id"
        or "subledger_documents"."party_id" is distinct from excluded."party_id"
        or "subledger_documents"."document_number" is distinct from excluded."document_number"
        or "subledger_documents"."document_date" is distinct from excluded."document_date"
        or "subledger_documents"."due_date" is distinct from excluded."due_date"
        or "subledger_documents"."currency_code" is distinct from excluded."currency_code"
        or "subledger_documents"."original_amount" is distinct from excluded."original_amount"
        or "subledger_documents"."metadata" is distinct from excluded."metadata"`,
      [
        documentId,
        input.facts.company.tenantId,
        input.companyId,
        input.facts.source.sourceId,
        documentType,
        transaction.transactionId,
        transaction.partyId ?? null,
        normalized.transactionNumber ?? null,
        normalized.transactionDate,
        normalized.dueDate ?? normalized.transactionDate,
        normalized.currencyCode ?? input.facts.company.baseCurrencyCode,
        originalAmount,
        initialState.openAmount,
        initialState.status,
        idempotencyKey,
        eventId,
        JSON.stringify({
          provider: "quickbooks",
          sourceTransactionId: normalized.sourceTransactionId,
          sourceTransactionType: normalized.sourceTransactionType,
          sourceUpdatedAt: normalized.sourceUpdatedAt ?? null,
          reportedOpenAmount: normalized.openAmount ?? normalized.unappliedAmount ?? null,
          emailStatus: normalized.emailStatus ?? null,
          printStatus: normalized.printStatus ?? null
        }),
        input.importedAt
      ]
    );
    documents += result.rowCount ?? 0;

    const persistedLineNumbers: number[] = [];
    for (const line of normalized.lines) {
      const amount = positiveAmount(line.sourceAmount);
      const item = line.itemRef === undefined ? undefined : itemBySourceId.get(line.itemRef.sourceObjectId);
      const accountId = line.accountRef === undefined
        ? documentLineItemAccount(documentType, item)
        : accountIdBySourceId.get(line.accountRef.sourceObjectId);
      if (amount === undefined || accountId === undefined) {
        if (amount !== undefined) {
          throw new Error(
            `QuickBooks ${normalized.sourceTransactionType} ${normalized.sourceTransactionId} line ${line.sourceLineId ?? String(line.lineNumber)} has an amount but no canonical account`
          );
        }
        continue;
      }
      const commercialAmounts = commercialLineAmounts(amount, line.sourceQuantity, line.sourceUnitAmount);
      const lineResult = await input.client.query(
        `insert into "erp_financials"."subledger_document_lines" (
          "subledger_document_line_id", "tenant_id", "company_id", "source_id",
          "subledger_document_id", "line_number", "account_id", "item_id", "description",
          "quantity", "unit_amount", "discount_amount", "tax_code", "tax_amount",
          "dimension_refs", "line_amount"
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
        on conflict ("tenant_id", "company_id", "source_id", "subledger_document_id", "line_number") do update
        set "account_id" = excluded."account_id", "item_id" = excluded."item_id",
          "description" = excluded."description", "quantity" = excluded."quantity",
          "unit_amount" = excluded."unit_amount", "discount_amount" = excluded."discount_amount",
          "tax_code" = excluded."tax_code", "tax_amount" = excluded."tax_amount",
          "dimension_refs" = excluded."dimension_refs", "line_amount" = excluded."line_amount"`,
        [
          stableId("qbo_document_line", documentId, line.sourceLineId ?? String(line.lineNumber)),
          input.facts.company.tenantId,
          input.companyId,
          input.facts.source.sourceId,
          documentId,
          line.lineNumber,
          accountId,
          item?.itemId ?? null,
          line.description ?? null,
          commercialAmounts.quantity,
          commercialAmounts.unitAmount,
          commercialAmounts.discountAmount,
          line.taxCode ?? null,
          commercialAmounts.taxAmount,
          JSON.stringify(line.dimensionRefs ?? []),
          amount
        ]
      );
      documentLines += lineResult.rowCount ?? 0;
      persistedLineNumbers.push(line.lineNumber);
    }
    await input.client.query(
      `delete from "erp_financials"."subledger_document_lines"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "subledger_document_id" = $4 and not ("line_number" = any($5::int[]))`,
      [input.facts.company.tenantId, input.companyId, input.facts.source.sourceId, documentId, persistedLineNumbers]
    );
  }

  let applications = 0;
  let skippedApplications = 0;
  const unresolvedApplications: QuickBooksSubledgerImportResult["unresolvedApplications"][number][] = [];
  for (const resource of operationalDocuments) {
    if (resource.syncAction === "voided" || resource.syncAction === "deleted") continue;
    const source = resource.resource;
    if (importedApplicationType(source.sourceTransactionType) === undefined) continue;
    const sourceDocumentId = documentIdBySourceId.get(source.sourceTransactionId);
    if (sourceDocumentId === undefined) continue;
    const incomingApplicationIds = new Set(
      source.lines.flatMap((line) => (line.linkedTransactions ?? []).map((linked) => {
        const targetDocumentId = documentIdBySourceId.get(linked.sourceTransactionId);
        return targetDocumentId === undefined
          ? undefined
          : stableId("qbo_application", sourceDocumentId, targetDocumentId, line.sourceLineId ?? String(line.lineNumber));
      })).filter((value): value is string => value !== undefined)
    );
    const existingApplications = await input.client.query<{
      subledger_application_id: string;
      version: number;
    }>(
      `select "subledger_application_id", "version"
from "erp_financials"."subledger_applications"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "source_document_id" = $4 and "status" = 'applied'`,
      [input.facts.company.tenantId, input.companyId, input.facts.source.sourceId, sourceDocumentId]
    );
    for (const existing of existingApplications.rows) {
      if (incomingApplicationIds.has(existing.subledger_application_id)) continue;
      const endedEventId = stableId(
        "qbo_event",
        existing.subledger_application_id,
        "unapplied",
        source.sourceUpdatedAt ?? input.facts.importBatch.importBatchId
      );
      await insertLifecycleEvent(input.client, {
        eventId: endedEventId,
        tenantId: input.facts.company.tenantId,
        companyId: input.companyId,
        sourceId: input.facts.source.sourceId,
        aggregateId: existing.subledger_application_id,
        eventType: "quickbooks_application_removed",
        occurredAt: source.sourceUpdatedAt ?? input.importedAt,
        recordedAt: input.importedAt,
        idempotencyKey: `quickbooks:application-removed:${existing.subledger_application_id}:${source.sourceUpdatedAt ?? input.facts.importBatch.importBatchId}`,
        payload: {
          provider: "quickbooks",
          sourceTransactionId: source.sourceTransactionId,
          importBatchId: input.facts.importBatch.importBatchId
        }
      });
      await input.client.query(
        `update "erp_financials"."subledger_applications"
set "status" = 'voided', "version" = "version" + 1, "ended_event_id" = $5, "updated_at" = $6
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "subledger_application_id" = $4 and "status" = 'applied'`,
        [
          input.facts.company.tenantId,
          input.companyId,
          input.facts.source.sourceId,
          existing.subledger_application_id,
          endedEventId,
          input.importedAt
        ]
      );
    }
  }
  for (const resource of operationalDocuments) {
    if (resource.syncAction === "voided" || resource.syncAction === "deleted") continue;
    const source = resource.resource;
    const applicationType = importedApplicationType(source.sourceTransactionType);
    if (applicationType === undefined) continue;
    const sourceDocumentId = documentIdBySourceId.get(source.sourceTransactionId);
    if (sourceDocumentId === undefined) continue;
    for (const line of source.lines) {
      if ((line.linkedTransactions?.length ?? 0) > 1) {
        throw new Error(
          `QuickBooks ${source.sourceTransactionType} ${source.sourceTransactionId} line ${line.sourceLineId ?? String(line.lineNumber)} links multiple documents without per-link amounts`
        );
      }
      for (const linked of line.linkedTransactions ?? []) {
        const targetDocumentId = documentIdBySourceId.get(linked.sourceTransactionId);
        const amount = positiveAmount(line.sourceAmount);
        if (targetDocumentId === undefined || amount === undefined) {
          skippedApplications += 1;
          unresolvedApplications.push({
            sourceTransactionId: source.sourceTransactionId,
            targetSourceTransactionId: linked.sourceTransactionId,
            sourceLineId: line.sourceLineId ?? String(line.lineNumber),
            reason: targetDocumentId === undefined ? "missing_target_document" : "missing_positive_amount"
          });
          continue;
        }
        const applicationId = stableId("qbo_application", sourceDocumentId, targetDocumentId, line.sourceLineId ?? String(line.lineNumber));
        const eventId = stableId("qbo_event", applicationId, "applied");
        const idempotencyKey = `quickbooks:application:${input.facts.source.sourceId}:${source.sourceTransactionId}:${linked.sourceTransactionId}:${line.sourceLineId ?? String(line.lineNumber)}`;
        const payload: JsonValue = {
          provider: "quickbooks",
          sourceTransactionId: source.sourceTransactionId,
          targetSourceTransactionId: linked.sourceTransactionId,
          importBatchId: input.facts.importBatch.importBatchId
        };
        await insertLifecycleEvent(input.client, {
          eventId,
          tenantId: input.facts.company.tenantId,
          companyId: input.companyId,
          sourceId: input.facts.source.sourceId,
          aggregateId: applicationId,
          eventType: "quickbooks_application_imported",
          occurredAt: source.sourceUpdatedAt ?? input.importedAt,
          recordedAt: input.importedAt,
          idempotencyKey: `${idempotencyKey}:event`,
          payload
        });
        const result = await input.client.query(
          `insert into "erp_financials"."subledger_applications" (
            "subledger_application_id", "tenant_id", "company_id", "source_id", "application_type",
            "source_document_id", "target_document_id", "applied_amount", "currency_code",
            "application_date", "status", "version", "idempotency_key", "applied_event_id",
            "created_at", "updated_at"
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'applied',1,$11,$12,$13,$13)
          on conflict ("tenant_id", "company_id", "source_id", "idempotency_key") do update
          set "applied_amount" = excluded."applied_amount",
            "application_date" = excluded."application_date",
            "status" = 'applied', "version" = "subledger_applications"."version" + 1,
            "ended_event_id" = null, "updated_at" = excluded."updated_at"
          where "subledger_applications"."applied_amount" is distinct from excluded."applied_amount"
            or "subledger_applications"."application_date" is distinct from excluded."application_date"
            or "subledger_applications"."status" <> 'applied'`,
          [
            applicationId,
            input.facts.company.tenantId,
            input.companyId,
            input.facts.source.sourceId,
            applicationType,
            sourceDocumentId,
            targetDocumentId,
            amount,
            source.currencyCode ?? input.facts.company.baseCurrencyCode,
            source.transactionDate,
            idempotencyKey,
            eventId,
            input.importedAt
          ]
        );
        applications += result.rowCount ?? 0;
      }
    }
  }

  for (const resource of operationalDocuments) {
    if (resource.syncAction !== "voided" && resource.syncAction !== "deleted") continue;
    const source = resource.resource;
    const documentId = documentIdBySourceId.get(source.sourceTransactionId);
    if (documentId === undefined) continue;
    const outcome = await voidQuickBooksDocument(input, {
      documentId,
      sourceTransactionId: source.sourceTransactionId,
      action: resource.syncAction,
      occurredAt: source.sourceUpdatedAt ?? input.importedAt
    });
    voidedDocuments += outcome.documents;
    removedLedgerPostings += outcome.postings;
  }

  if (input.replaceMissingDocuments === true) {
    const incomingSourceIds = operationalDocuments
      .filter((resource) => importedDocumentType(resource.resource.sourceTransactionType) !== undefined)
      .map((resource) => resource.resource.sourceTransactionId);
    const missing = await input.client.query<{
      subledger_document_id: string;
      source_transaction_id: string;
    }>(
      `select "subledger_document_id", "metadata" ->> 'sourceTransactionId' as "source_transaction_id"
from "erp_financials"."subledger_documents"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "metadata" ->> 'provider' = 'quickbooks' and "status" <> 'voided'
  and not ("metadata" ->> 'sourceTransactionId' = any($4::text[]))`,
      [input.facts.company.tenantId, input.companyId, input.facts.source.sourceId, incomingSourceIds]
    );
    for (const document of missing.rows) {
      const outcome = await voidQuickBooksDocument(input, {
        documentId: document.subledger_document_id,
        sourceTransactionId: document.source_transaction_id,
        action: "deleted",
        occurredAt: input.importedAt,
        reason: "missing_from_full_snapshot"
      });
      voidedDocuments += outcome.documents;
      removedLedgerPostings += outcome.postings;
    }
  }

  const retiredNonDocumentTransactions = [
    ...(input.resources.journalEntries ?? []).map((resource) => ({
      syncAction: resource.syncAction,
      sourceTransactionType: "JournalEntry",
      sourceTransactionId: resource.resource.Id
    })),
    ...(input.resources.operationalDocuments ?? input.resources.ledgerTransactions ?? []).map((resource) => ({
      syncAction: resource.syncAction,
      sourceTransactionType: resource.resource.sourceTransactionType,
      sourceTransactionId: resource.resource.sourceTransactionId
    }))
  ];
  const retiredTransactionKeys = new Set<string>();
  for (const resource of retiredNonDocumentTransactions) {
    if (resource.syncAction !== "voided" && resource.syncAction !== "deleted") continue;
    if (importedDocumentType(resource.sourceTransactionType) !== undefined) continue;
    const key = `${resource.sourceTransactionType}:${resource.sourceTransactionId}`;
    if (retiredTransactionKeys.has(key)) continue;
    retiredTransactionKeys.add(key);
    const postingsResult = await input.client.query(
      `delete from "erp_financials"."ledger_postings" posting
using "erp_financials"."transactions" transaction
where transaction."tenant_id" = $1 and transaction."source_id" = $2
  and transaction."source_transaction_type" = $3 and transaction."source_transaction_id" = $4
  and posting."tenant_id" = transaction."tenant_id"
  and posting."source_id" = transaction."source_id"
  and posting."transaction_id" = transaction."transaction_id"`,
      [input.facts.company.tenantId, input.facts.source.sourceId,
        resource.sourceTransactionType, resource.sourceTransactionId]
    );
    removedLedgerPostings += postingsResult.rowCount ?? 0;
  }

  await input.client.query(
    `select set_config('erp_financials.quickbooks_projection_refresh', 'off', true)`
  );
  return {
    documents,
    documentLines,
    applications,
    skippedTransactions,
    skippedDocumentLines,
    skippedApplications,
    voidedDocuments,
    removedLedgerPostings,
    unresolvedApplications
  };
}

async function voidQuickBooksDocument(
  input: PersistQuickBooksSubledgerResourcesInput & { readonly client: PostgresQueryClient },
  target: {
    readonly documentId: string;
    readonly sourceTransactionId: string;
    readonly action: "voided" | "deleted";
    readonly occurredAt: string;
    readonly reason?: "missing_from_full_snapshot";
  }
): Promise<{ readonly documents: number; readonly postings: number }> {
  const activeApplications = await input.client.query<{ subledger_application_id: string }>(
    `select "subledger_application_id"
from "erp_financials"."subledger_applications"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "status" = 'applied'
  and ("source_document_id" = $4 or "target_document_id" = $4)`,
    [input.facts.company.tenantId, input.companyId, input.facts.source.sourceId, target.documentId]
  );
  for (const application of activeApplications.rows) {
    const endedEventId = stableId(
      "qbo_event", application.subledger_application_id, target.action,
      target.reason ?? input.facts.importBatch.importBatchId
    );
    await insertLifecycleEvent(input.client, {
      eventId: endedEventId,
      tenantId: input.facts.company.tenantId,
      companyId: input.companyId,
      sourceId: input.facts.source.sourceId,
      aggregateId: application.subledger_application_id,
      eventType: `quickbooks_application_${target.action}`,
      occurredAt: target.occurredAt,
      recordedAt: input.importedAt,
      idempotencyKey: `quickbooks:application-${target.action}:${application.subledger_application_id}:${target.reason ?? input.facts.importBatch.importBatchId}`,
      payload: {
        provider: "quickbooks",
        sourceTransactionId: target.sourceTransactionId,
        importBatchId: input.facts.importBatch.importBatchId,
        ...(target.reason === undefined ? {} : { reason: target.reason })
      }
    });
    await input.client.query(
      `update "erp_financials"."subledger_applications"
set "status" = 'voided', "version" = "version" + 1, "ended_event_id" = $5, "updated_at" = $6
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "subledger_application_id" = $4 and "status" = 'applied'`,
      [input.facts.company.tenantId, input.companyId, input.facts.source.sourceId,
        application.subledger_application_id, endedEventId, input.importedAt]
    );
  }
  const eventId = stableId("qbo_event", target.documentId, target.action, target.reason ?? input.facts.importBatch.importBatchId);
  await insertLifecycleEvent(input.client, {
    eventId,
    tenantId: input.facts.company.tenantId,
    companyId: input.companyId,
    sourceId: input.facts.source.sourceId,
    aggregateId: target.documentId,
    eventType: `quickbooks_document_${target.action}`,
    occurredAt: target.occurredAt,
    recordedAt: input.importedAt,
    idempotencyKey: `quickbooks:document-${target.action}:${target.documentId}:${target.reason ?? input.facts.importBatch.importBatchId}`,
    payload: {
      provider: "quickbooks",
      sourceTransactionId: target.sourceTransactionId,
      importBatchId: input.facts.importBatch.importBatchId,
      ...(target.reason === undefined ? {} : { reason: target.reason })
    }
  });
  const documentResult = await input.client.query(
    `update "erp_financials"."subledger_documents"
set "open_amount" = 0, "status" = 'voided', "version" = "version" + 1,
  "metadata" = "metadata" || jsonb_build_object('syncAction', $5::text, 'importBatchId', $6::text, 'retirementReason', $7::text),
  "updated_at" = $8
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "subledger_document_id" = $4 and "status" <> 'voided'`,
    [input.facts.company.tenantId, input.companyId, input.facts.source.sourceId, target.documentId,
      target.action, input.facts.importBatch.importBatchId, target.reason ?? target.action, input.importedAt]
  );
  const postingsResult = await input.client.query(
    `delete from "erp_financials"."ledger_postings" posting
using "erp_financials"."transactions" transaction
where transaction."tenant_id" = $1 and transaction."source_id" = $2
  and transaction."source_transaction_id" = $3
  and posting."tenant_id" = transaction."tenant_id"
  and posting."source_id" = transaction."source_id"
  and posting."transaction_id" = transaction."transaction_id"`,
    [input.facts.company.tenantId, input.facts.source.sourceId, target.sourceTransactionId]
  );
  return { documents: documentResult.rowCount ?? 0, postings: postingsResult.rowCount ?? 0 };
}

function initialDocumentState(
  documentType: ImportedDocumentType,
  originalAmount: string
): { readonly openAmount: string; readonly status: "open" | "settled" } {
  if (["refund", "deposit", "transfer", "sales_receipt", "purchase"].includes(documentType)) {
    return { openAmount: "0.00", status: "settled" };
  }
  return { openAmount: originalAmount, status: "open" };
}

function documentLineItemAccount(
  documentType: ImportedDocumentType,
  item: CanonicalAccountingFactSet["items"][number] | undefined
): string | undefined {
  if (item === undefined) return undefined;
  if (documentType === "invoice" || documentType === "credit_memo" || documentType === "refund" || documentType === "sales_receipt") {
    return item.incomeAccountId;
  }
  if (documentType === "vendor_bill" || documentType === "purchase" || documentType === "vendor_credit") {
    return item.expenseAccountId;
  }
  return item.assetAccountId ?? item.expenseAccountId ?? item.incomeAccountId;
}

function importedDocumentType(sourceType: string): ImportedDocumentType | undefined {
  const types: Readonly<Record<string, ImportedDocumentType>> = {
    Invoice: "invoice",
    Payment: "customer_payment",
    CreditMemo: "credit_memo",
    RefundReceipt: "refund",
    Bill: "vendor_bill",
    BillPayment: "bill_payment",
    Deposit: "deposit",
    Transfer: "transfer",
    SalesReceipt: "sales_receipt",
    Purchase: "purchase",
    VendorCredit: "vendor_credit"
  };
  return types[sourceType];
}

function importedApplicationType(sourceType: string): ImportedApplicationType | undefined {
  const types: Readonly<Record<string, ImportedApplicationType>> = {
    Payment: "customer_payment_to_invoice",
    BillPayment: "bill_payment_to_bill",
    CreditMemo: "credit_to_invoice",
    VendorCredit: "vendor_credit_to_bill"
  };
  return types[sourceType];
}

function positiveAmount(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const amount = Math.abs(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : undefined;
}

function commercialLineAmounts(
  amountValue: string,
  quantityValue: string | undefined,
  unitAmountValue: string | undefined
): { readonly quantity: string; readonly unitAmount: string; readonly discountAmount: string; readonly taxAmount: string } {
  const amount = Number(amountValue);
  const quantity = Number(quantityValue);
  const unitAmount = Number(unitAmountValue);
  if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitAmount) && unitAmount >= 0) {
    const gross = quantity * unitAmount;
    return {
      quantity: quantity.toFixed(2),
      unitAmount: unitAmount.toFixed(2),
      discountAmount: Math.max(gross - amount, 0).toFixed(2),
      taxAmount: Math.max(amount - gross, 0).toFixed(2)
    };
  }
  return { quantity: "1.00", unitAmount: amount.toFixed(2), discountAmount: "0.00", taxAmount: "0.00" };
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24)}`;
}

async function insertLifecycleEvent(client: PostgresQueryClient, input: {
  readonly eventId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly sourceId: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly idempotencyKey: string;
  readonly payload: JsonValue;
}): Promise<void> {
  const payload = JSON.stringify(input.payload);
  await client.query(
    `insert into "erp_financials"."financial_lifecycle_events" (
      "event_id", "tenant_id", "company_id", "source_id", "aggregate_type", "aggregate_id",
      "event_type", "actor_ref", "request_id", "correlation_id", "reason_code",
      "occurred_at", "recorded_at", "idempotency_key", "payload_checksum", "payload"
    ) values ($1,$2,$3,$4,'quickbooks_import',$5,$6,'system:quickbooks-import',$7,$7,
      'quickbooks_historical_import',$8,$9,$10,$11,$12::jsonb)
    on conflict ("tenant_id", "company_id", "source_id", "idempotency_key") do nothing`,
    [
      input.eventId,
      input.tenantId,
      input.companyId,
      input.sourceId,
      input.aggregateId,
      input.eventType,
      input.idempotencyKey,
      input.occurredAt,
      input.recordedAt,
      input.idempotencyKey,
      createHash("sha256").update(payload).digest("hex"),
      payload
    ]
  );
}
