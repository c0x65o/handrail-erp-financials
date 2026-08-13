import { createHash } from "node:crypto";

import { assertValidAccountHierarchy } from "./account-hierarchy.js";
import { assertNoCredentialKeys, createDimensionHash } from "./canonical-model.js";
import { ACCOUNT_HIERARCHY_CHANGED_STALE_REASON } from "./rollup-jobs.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";
import { appendFinancialLifecycleEvent, assertFinancialOperationContext } from "./financial-lifecycle.js";
import { assertIndependentApproval } from "./financial-lifecycle.js";
import { assertPostingDateAllowed, createFiscalPeriodService } from "./fiscal-periods.js";
import { ErpFinancialsError } from "./sdk-errors.js";
import { appendFinancialOutboxEvent } from "./financial-outbox.js";
import { normalizeCommercialDocumentLine } from "./commercial-lines.js";

import type {
  Account,
  AccountClassification,
  AccountId,
  AccountingBasis,
  AccountingTransaction,
  DecimalString,
  DimensionRef,
  ImportBatch,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  JsonValue,
  LedgerPosting,
  SafeSourcePayloadRef,
  TransactionLine
} from "./canonical-model.js";
import type { PostgresQueryClient } from "./postgres-storage.js";
import type { FinancialOperationContext } from "./financial-lifecycle.js";
import type { FiscalPeriodService } from "./fiscal-periods.js";
import type { ErpFinancialsErrorCode, ErpFinancialsErrorDetails } from "./sdk-errors.js";
import type { CommercialDocumentLineInput, NormalizedCommercialDocumentLine } from "./commercial-lines.js";

export const JOURNAL_ENTRY_POSTED_STALE_REASON = "journal_entry_posted";

const ACCOUNT_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "asset",
  "liability",
  "equity",
  "income",
  "cost_of_goods_sold",
  "expense",
  "other_income",
  "other_expense"
]);
const ACCOUNTING_BASES: ReadonlySet<string> = new Set(["accrual", "cash", "modified_cash"]);

export type ErpFinancialsTransactionRunner = {
  transaction<Result>(operation: (client: PostgresQueryClient) => Promise<Result>): Promise<Result>;
};

export type ErpFinancialsPostgresTransactionClient = PostgresQueryClient & {
  release(): void;
};

export type ErpFinancialsPostgresPool = {
  connect(): Promise<ErpFinancialsPostgresTransactionClient>;
};

export type ErpFinancialsDatabase = ErpFinancialsTransactionRunner | ErpFinancialsPostgresPool;

export type CreateErpFinancialsInput = {
  readonly database: ErpFinancialsDatabase;
  readonly tenantId: string;
  readonly companyId: string;
  readonly sourceId: string;
  readonly bookId?: string;
  readonly currencyCode: IsoCurrencyCode;
  /**
   * V1 deliberately supports one base currency per service scope. Foreign
   * currency needs explicit exchange-rate, revaluation, and realized-gain/loss
   * behavior and is rejected until that complete contract is available.
   */
  readonly currencyPolicy?: "single_currency";
  readonly accountingBasis?: AccountingBasis;
  readonly postingPolicy?: "enforce_fiscal_periods" | "legacy_unrestricted";
  readonly now?: () => IsoDateTime;
};

export type ErpFinancialsAccountReference =
  | { readonly accountKey: string; readonly accountId?: never }
  | { readonly accountId: AccountId; readonly accountKey?: never };

export type ErpFinancialsAccountDefinition = ErpFinancialsAccountReference & {
  readonly sourceAccountId?: string;
  readonly accountNumber?: string;
  readonly name: string;
  readonly classification: AccountClassification;
  readonly type?: string;
  readonly subtype?: string;
  readonly active?: boolean;
  readonly currencyCode?: IsoCurrencyCode;
};

export type ErpFinancialsAccountTreeNode = ErpFinancialsAccountDefinition & {
  readonly children?: readonly ErpFinancialsAccountTreeNode[];
};

export type UpsertAccountTreeInput = {
  readonly operation: FinancialOperationContext;
  readonly parent: ErpFinancialsAccountDefinition;
  readonly children?: readonly ErpFinancialsAccountTreeNode[];
  readonly staleReason?: string;
};

export type UpsertAccountTreeResult = {
  readonly accounts: readonly Account[];
  readonly accountsWritten: number;
  readonly snapshotsMarkedStale: number;
  readonly lifecycleEventId: string;
};

type JournalEntryLineCommon = ErpFinancialsAccountReference & {
  readonly lineId?: string;
  readonly description?: string;
  readonly partyId?: string;
  readonly itemId?: string;
  readonly dimensionRefs?: readonly DimensionRef[];
};

export type PostJournalEntryLineInput = JournalEntryLineCommon &
  (
    | { readonly debit: DecimalString; readonly credit?: never }
    | { readonly credit: DecimalString; readonly debit?: never }
  );

export type PostJournalEntryInput = {
  readonly operation: FinancialOperationContext;
  readonly idempotencyKey: string;
  readonly date: IsoDate;
  readonly transactionNumber?: string;
  readonly memo?: string;
  readonly postedAt?: IsoDateTime;
  readonly currencyCode?: IsoCurrencyCode;
  readonly accountingBasis?: AccountingBasis;
  readonly adjustment?: boolean;
  readonly lines: readonly PostJournalEntryLineInput[];
  readonly staleReason?: string;
};

export type JournalEntryWriteCounts = {
  readonly importBatches: number;
  readonly transactions: number;
  readonly transactionLines: number;
  readonly postings: number;
};

export type PostJournalEntryResult = {
  readonly status: "posted" | "already_posted";
  readonly transactionId: string;
  readonly transactionLineIds: readonly string[];
  readonly postingIds: readonly string[];
  readonly importBatchId: string;
  readonly snapshotsMarkedStale: number;
  readonly writeCounts: JournalEntryWriteCounts;
  readonly lifecycleEventId: string;
};

export type ReverseJournalEntryInput = {
  readonly originalTransactionId: string;
  readonly idempotencyKey: string;
  readonly date: IsoDate;
  readonly memo?: string;
  readonly operation: FinancialOperationContext;
};

export type ReplaceJournalEntryInput = ReverseJournalEntryInput & {
  readonly replacement: Omit<PostJournalEntryInput, "operation" | "adjustment">;
};

export type JournalEntryLifecycleResult = {
  readonly outcome: "reversed" | "voided" | "corrected" | "replaced";
  readonly originalTransactionId: string;
  readonly reversal: PostJournalEntryResult;
  readonly replacement?: PostJournalEntryResult;
  readonly journalEntryLinkIds: readonly string[];
  readonly lifecycleEventIds: readonly string[];
};

export type SubledgerDocumentType =
  | "invoice"
  | "customer_payment"
  | "credit_memo"
  | "refund"
  | "vendor_bill"
  | "bill_payment"
  | "write_off"
  | "deposit"
  | "transfer";

export type SubledgerAmountLine = ErpFinancialsAccountReference & CommercialDocumentLineInput;

type SubledgerDocumentInputCommon = {
  readonly operation: FinancialOperationContext;
  readonly idempotencyKey: string;
  readonly date: IsoDate;
  readonly documentNumber?: string;
  readonly currencyCode?: IsoCurrencyCode;
  readonly memo?: string;
};

export type CreateInvoiceInput = SubledgerDocumentInputCommon & {
  readonly customerId: string;
  readonly dueDate: IsoDate;
  readonly receivableAccount: ErpFinancialsAccountReference;
  readonly revenueLines: readonly SubledgerAmountLine[];
};

export type RecordCustomerPaymentInput = SubledgerDocumentInputCommon & {
  readonly customerId: string;
  readonly amount: DecimalString;
  readonly cashAccount: ErpFinancialsAccountReference;
  readonly receivableAccount: ErpFinancialsAccountReference;
};

type IssueCreditMemoCommon = SubledgerDocumentInputCommon & {
  readonly customerId: string;
  readonly receivableAccount: ErpFinancialsAccountReference;
};

export type IssueCreditMemoInput = IssueCreditMemoCommon &
  (
    | {
        /** Prefer revenueLines so tax, item, dimensions, and account provenance are preserved. */
        readonly amount: DecimalString;
        readonly revenueAccount: ErpFinancialsAccountReference;
        readonly revenueLines?: never;
      }
    | {
        readonly revenueLines: readonly SubledgerAmountLine[];
        readonly amount?: never;
        readonly revenueAccount?: never;
      }
  );

export type IssueRefundInput = SubledgerDocumentInputCommon & {
  readonly customerId: string;
  readonly amount: DecimalString;
  readonly receivableAccount: ErpFinancialsAccountReference;
  readonly cashAccount: ErpFinancialsAccountReference;
};

export type CreateVendorBillInput = SubledgerDocumentInputCommon & {
  readonly vendorId: string;
  readonly dueDate: IsoDate;
  readonly payableAccount: ErpFinancialsAccountReference;
  readonly expenseLines: readonly SubledgerAmountLine[];
};

export type RecordBillPaymentInput = SubledgerDocumentInputCommon & {
  readonly vendorId: string;
  readonly amount: DecimalString;
  readonly payableAccount: ErpFinancialsAccountReference;
  readonly cashAccount: ErpFinancialsAccountReference;
};

export type RecordWriteOffInput = SubledgerDocumentInputCommon & {
  readonly partyId: string;
  readonly amount: DecimalString;
  readonly balanceType: "receivable" | "payable";
  readonly balanceAccount: ErpFinancialsAccountReference;
  readonly writeOffAccount: ErpFinancialsAccountReference;
};

export type RecordDepositInput = SubledgerDocumentInputCommon & {
  readonly amount: DecimalString;
  readonly bankAccount: ErpFinancialsAccountReference;
  readonly clearingAccount: ErpFinancialsAccountReference;
};

export type RecordTransferInput = SubledgerDocumentInputCommon & {
  readonly amount: DecimalString;
  readonly fromAccount: ErpFinancialsAccountReference;
  readonly toAccount: ErpFinancialsAccountReference;
};

export type SubledgerDocumentResult = {
  readonly status: "posted" | "already_posted";
  readonly documentId: string;
  readonly documentType: SubledgerDocumentType;
  readonly originalAmount: DecimalString;
  readonly openAmount: DecimalString;
  readonly documentStatus: "open" | "partially_applied" | "settled" | "voided";
  readonly version: number;
  readonly journal: PostJournalEntryResult;
};

export type SubledgerApplicationType =
  | "customer_payment_to_invoice"
  | "bill_payment_to_bill"
  | "credit_to_invoice";

export type ApplySubledgerPaymentInput = {
  readonly operation: FinancialOperationContext;
  readonly idempotencyKey: string;
  readonly applicationType: SubledgerApplicationType;
  readonly sourceDocumentId: string;
  readonly targetDocumentId: string;
  readonly amount: DecimalString;
  readonly applicationDate: IsoDate;
  readonly expectedSourceVersion: number;
  readonly expectedTargetVersion: number;
  readonly match?: {
    readonly matchCandidateId: string;
    readonly matchDecisionId: string;
    readonly method: "automatic" | "manual";
    readonly score: DecimalString;
    readonly evidence?: JsonValue;
  };
};

export type EndSubledgerApplicationInput = {
  readonly operation: FinancialOperationContext;
  readonly applicationId: string;
  readonly expectedVersion: number;
};

export type SubledgerApplicationResult = {
  readonly status: "applied" | "already_applied" | "unapplied" | "voided";
  readonly applicationId: string;
  readonly version: number;
  readonly sourceDocumentId: string;
  readonly targetDocumentId: string;
  readonly appliedAmount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly matchCandidateId?: string;
  readonly matchDecisionId?: string;
  readonly matchMethod?: "automatic" | "manual";
  readonly matchScore?: DecimalString;
  readonly lifecycleEventId: string;
};

export type ErpFinancials = {
  readonly accounts: {
    upsertTree(input: UpsertAccountTreeInput): Promise<UpsertAccountTreeResult>;
  };
  readonly journalEntries: {
    post(input: PostJournalEntryInput): Promise<PostJournalEntryResult>;
    postAdjustment(input: Omit<PostJournalEntryInput, "adjustment">): Promise<PostJournalEntryResult>;
    reverse(input: ReverseJournalEntryInput): Promise<JournalEntryLifecycleResult>;
    void(input: ReverseJournalEntryInput): Promise<JournalEntryLifecycleResult>;
    correct(input: ReplaceJournalEntryInput): Promise<JournalEntryLifecycleResult>;
    replace(input: ReplaceJournalEntryInput): Promise<JournalEntryLifecycleResult>;
  };
  readonly fiscalPeriods: FiscalPeriodService;
  readonly invoices: { create(input: CreateInvoiceInput): Promise<SubledgerDocumentResult> };
  readonly customerPayments: { record(input: RecordCustomerPaymentInput): Promise<SubledgerDocumentResult> };
  readonly credits: { issue(input: IssueCreditMemoInput): Promise<SubledgerDocumentResult> };
  readonly refunds: { issue(input: IssueRefundInput): Promise<SubledgerDocumentResult> };
  readonly vendorBills: { create(input: CreateVendorBillInput): Promise<SubledgerDocumentResult> };
  readonly billPayments: { record(input: RecordBillPaymentInput): Promise<SubledgerDocumentResult> };
  readonly writeOffs: { record(input: RecordWriteOffInput): Promise<SubledgerDocumentResult> };
  readonly deposits: { record(input: RecordDepositInput): Promise<SubledgerDocumentResult> };
  readonly transfers: { record(input: RecordTransferInput): Promise<SubledgerDocumentResult> };
  readonly paymentApplications: {
    apply(input: ApplySubledgerPaymentInput): Promise<SubledgerApplicationResult>;
    unapply(input: EndSubledgerApplicationInput): Promise<SubledgerApplicationResult>;
    void(input: EndSubledgerApplicationInput): Promise<SubledgerApplicationResult>;
  };
};

export class ErpFinancialsValidationError extends ErpFinancialsError {
  constructor(
    message: string,
    code: ErpFinancialsErrorCode = "invalid_input",
    details: ErpFinancialsErrorDetails = {}
  ) {
    super(code, message, { details });
    this.name = "ErpFinancialsValidationError";
    Object.setPrototypeOf(this, ErpFinancialsValidationError.prototype);
  }
}

export class ErpFinancialsIdempotencyConflictError extends ErpFinancialsError {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      "idempotency_conflict",
      `Financial operation idempotency key ${idempotencyKey} is already associated with different content or status`,
      { details: { idempotencyKey } }
    );
    this.name = "ErpFinancialsIdempotencyConflictError";
    this.idempotencyKey = idempotencyKey;
    Object.setPrototypeOf(this, ErpFinancialsIdempotencyConflictError.prototype);
  }
}

type ServiceContext = {
  readonly database: ErpFinancialsTransactionRunner;
  readonly tenantId: string;
  readonly companyId: string;
  readonly sourceId: string;
  readonly bookId?: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly currencyPolicy: "single_currency";
  readonly accountingBasis: AccountingBasis;
  readonly now: () => IsoDateTime;
  readonly postingPolicy: "enforce_fiscal_periods" | "legacy_unrestricted";
};

type NormalizedJournalLine = {
  readonly accountId: AccountId;
  readonly lineId: string;
  readonly lineNumber: number;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly description?: string;
  readonly partyId?: string;
  readonly itemId?: string;
  readonly dimensionRefs: readonly DimensionRef[];
};

type NormalizedJournalEntry = {
  readonly idempotencyKey: string;
  readonly date: IsoDate;
  readonly transactionNumber?: string;
  readonly memo?: string;
  readonly postedAt?: IsoDateTime;
  readonly currencyCode: IsoCurrencyCode;
  readonly accountingBasis: AccountingBasis;
  readonly lines: readonly NormalizedJournalLine[];
  readonly checksum: string;
  readonly staleReason: string;
  readonly adjustment: boolean;
  readonly sourceTransactionType: string;
  readonly lifecycleAggregateType: string;
  readonly lifecycleEventType: string;
  readonly partyId?: string;
};

type InternalPostJournalEntryInput = PostJournalEntryInput & {
  readonly nativeTransactionType?: string;
  readonly lifecycleAggregateType?: string;
  readonly lifecycleEventType?: string;
  readonly nativePartyId?: string;
};

type ExistingJournalRow = Record<string, unknown> & {
  readonly transaction_id?: unknown;
  readonly status?: unknown;
  readonly source_payload_ref?: unknown;
};

export function createErpFinancials(input: CreateErpFinancialsInput): ErpFinancials {
  const context = serviceContext(input);

  return {
    accounts: {
      upsertTree(treeInput) {
        return upsertAccountTree(context, treeInput);
      }
    },
    journalEntries: {
      post(journalInput) {
        return postJournalEntry(context, journalInput);
      },
      postAdjustment(journalInput) {
        return postJournalEntry(context, { ...journalInput, adjustment: true });
      },
      reverse(workflowInput) {
        return runJournalLifecycleWorkflow(context, "reversed", workflowInput);
      },
      void(workflowInput) {
        return runJournalLifecycleWorkflow(context, "voided", workflowInput);
      },
      correct(workflowInput) {
        return runJournalLifecycleWorkflow(context, "corrected", workflowInput);
      },
      replace(workflowInput) {
        return runJournalLifecycleWorkflow(context, "replaced", workflowInput);
      }
    },
    fiscalPeriods: createFiscalPeriodService(context),
    invoices: { create: (documentInput) => createInvoice(context, documentInput) },
    customerPayments: { record: (documentInput) => recordCustomerPayment(context, documentInput) },
    credits: { issue: (documentInput) => issueCreditMemo(context, documentInput) },
    refunds: { issue: (documentInput) => issueRefund(context, documentInput) },
    vendorBills: { create: (documentInput) => createVendorBill(context, documentInput) },
    billPayments: { record: (documentInput) => recordBillPayment(context, documentInput) },
    writeOffs: { record: (documentInput) => recordWriteOff(context, documentInput) },
    deposits: { record: (documentInput) => recordDeposit(context, documentInput) },
    transfers: { record: (documentInput) => recordTransfer(context, documentInput) },
    paymentApplications: {
      apply: (applicationInput) => applySubledgerPayment(context, applicationInput),
      unapply: (applicationInput) => endSubledgerApplication(context, applicationInput, "unapplied"),
      void: (applicationInput) => endSubledgerApplication(context, applicationInput, "voided")
    }
  };
}

export function createPostgresTransactionRunner(
  pool: ErpFinancialsPostgresPool
): ErpFinancialsTransactionRunner {
  return {
    async transaction<Result>(operation: (client: PostgresQueryClient) => Promise<Result>): Promise<Result> {
      const client = await pool.connect();
      let transactionStarted = false;

      try {
        await client.query("begin");
        transactionStarted = true;
        const result = await operation(client);
        await client.query("commit");
        return result;
      } catch (error) {
        if (transactionStarted) {
          await client.query("rollback");
        }
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function upsertAccountTree(
  context: ServiceContext,
  input: UpsertAccountTreeInput
): Promise<UpsertAccountTreeResult> {
  const accounts = flattenAccountTree(context, input);
  assertFinancialOperationContext(input.operation);

  return context.database.transaction(async (client) => {
    await acquireTransactionLock(client, `account-hierarchy:${context.tenantId}:${context.sourceId}`);
    await assertCompanySourceScope(client, context);
    const storage = createPostgresStorageAdapter(client);
    const existingAccounts = await storage.loadAccounts({
      tenantId: context.tenantId,
      sourceId: context.sourceId
    });

    assertAccountIdentitiesAreStable(existingAccounts, accounts);

    const prospectiveAccounts = new Map(existingAccounts.map((account) => [account.accountId, account]));
    for (const account of accounts) {
      prospectiveAccounts.set(account.accountId, account);
    }
    assertValidAccountHierarchy([...prospectiveAccounts.values()]);

    const accountsWritten = await storage.upsertAccounts(accounts);
    const snapshotsMarkedStale = await storage.markReportSnapshotsStaleForAccountHierarchyChanges({
      tenantId: context.tenantId,
      companyId: context.companyId,
      sourceId: context.sourceId,
      staleReason: input.staleReason ?? ACCOUNT_HIERARCHY_CHANGED_STALE_REASON
    });
    const lifecycle = await appendFinancialLifecycleEvent(client, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      sourceId: context.sourceId,
      aggregateType: "account_hierarchy",
      aggregateId: context.sourceId,
      eventType: "account_hierarchy.upserted",
      idempotencyKey: `account-hierarchy:${input.operation.requestId}`,
      operation: input.operation,
      recordedAt: context.now(),
      payload: {
        accountIds: accounts.map((account) => account.accountId),
        accountsWritten,
        snapshotsMarkedStale
      }
    });
    await appendServiceOutboxEvent(client, context, {
      eventType: "account_hierarchy.changed",
      aggregateType: "account_hierarchy",
      aggregateId: context.sourceId,
      idempotencyKey: `account-hierarchy:${input.operation.requestId}`,
      payload: {
        accountIds: accounts.map((account) => account.accountId),
        snapshotsMarkedStale
      }
    });

    return {
      accounts,
      accountsWritten,
      snapshotsMarkedStale,
      lifecycleEventId: lifecycle.eventId
    };
  });
}

async function postJournalEntry(
  context: ServiceContext,
  input: PostJournalEntryInput
): Promise<PostJournalEntryResult> {
  const journal = normalizeJournalEntry(context, input);
  assertFinancialOperationContext(input.operation);
  if (journal.adjustment) {
    assertIndependentApproval(input.operation);
  }
  const identities = journalIdentities(context, journal);

  return context.database.transaction(async (client) => {
    await acquireTransactionLock(
      client,
      `journal-entry:${context.tenantId}:${context.sourceId}:${journal.idempotencyKey}`
    );
    await assertCompanySourceScope(client, context);

    return executePostJournalEntryInTransaction(client, context, input, journal, identities);
  });
}

async function executePostJournalEntryInTransaction(
  client: PostgresQueryClient,
  context: ServiceContext,
  input: PostJournalEntryInput,
  journal: NormalizedJournalEntry,
  identities: ReturnType<typeof journalIdentities>
): Promise<PostJournalEntryResult> {
    const existing = await loadExistingJournal(
      client,
      context,
      journal.idempotencyKey,
      journal.sourceTransactionType
    );
    if (existing !== undefined) {
      if (
        existing.transactionId === identities.transactionId &&
        existing.status === "posted" &&
        sourceRefChecksum(existing.sourcePayloadRef) === journal.checksum
      ) {
        const lifecycle = await appendJournalPostedLifecycleEvent(client, context, input.operation, journal, identities);
        return alreadyPostedResult(identities, lifecycle.eventId);
      }
      throw new ErpFinancialsIdempotencyConflictError(journal.idempotencyKey);
    }

    if (context.postingPolicy === "enforce_fiscal_periods") {
      await assertPostingDateAllowed(client, context, journal.date, {
        allowClosingAdjustment: journal.adjustment
      });
    }

    const storage = createPostgresStorageAdapter(client);
    const accountIds = unique(journal.lines.map((line) => line.accountId));
    const accounts = await storage.loadAccounts({
      tenantId: context.tenantId,
      sourceId: context.sourceId,
      accountIds
    });
    assertJournalAccounts(accounts, accountIds);

    const postedAt = journal.postedAt ?? context.now();
    assertIsoDateTime(postedAt, "postedAt");
    const facts = journalFacts(context, journal, identities, postedAt);

    const writeCounts: JournalEntryWriteCounts = {
      importBatches: await storage.upsertImportBatch(facts.importBatch),
      transactions: await storage.upsertTransactions([facts.transaction]),
      transactionLines: await storage.upsertTransactionLines(facts.transactionLines),
      postings: await storage.upsertLedgerPostings(facts.postings)
    };
    const snapshotsMarkedStale = await storage.markReportSnapshotsStaleForPostingChanges({
      tenantId: context.tenantId,
      companyId: context.companyId,
      sourceId: context.sourceId,
      affectedStart: journal.date,
      affectedEnd: journal.date,
      staleReason: journal.staleReason,
      accountingBasis: journal.accountingBasis,
      currencyCode: journal.currencyCode
    });
    const lifecycle = await appendJournalPostedLifecycleEvent(client, context, input.operation, journal, identities);
    await appendServiceOutboxEvent(client, context, {
      eventType: "ledger.posted",
      aggregateType: journal.lifecycleAggregateType,
      aggregateId: identities.transactionId,
      idempotencyKey: `ledger-posted:${journal.sourceTransactionType}:${journal.idempotencyKey}`,
      payload: {
        accountingBasis: journal.accountingBasis,
        currencyCode: journal.currencyCode,
        postingDate: journal.date,
        postingIds: identities.postingIds,
        transactionId: identities.transactionId
      }
    });

    return {
      status: "posted",
      transactionId: identities.transactionId,
      transactionLineIds: identities.transactionLineIds,
      postingIds: identities.postingIds,
      importBatchId: identities.importBatchId,
      snapshotsMarkedStale,
      writeCounts,
      lifecycleEventId: lifecycle.eventId
    };
}

type SubledgerDocumentWrite = {
  readonly documentType: SubledgerDocumentType;
  readonly idempotencyKey: string;
  readonly date: IsoDate;
  readonly dueDate?: IsoDate;
  readonly documentNumber?: string;
  readonly partyId?: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly amount: DecimalString;
  readonly documentStartsOpen: boolean;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly journalLines: readonly PostJournalEntryLineInput[];
  readonly documentLines?: readonly (ErpFinancialsAccountReference & NormalizedCommercialDocumentLine)[];
  readonly memo?: string;
  readonly operation: FinancialOperationContext;
};

async function createInvoice(context: ServiceContext, input: CreateInvoiceInput): Promise<SubledgerDocumentResult> {
  const revenueLines = normalizeSubledgerLines(input.revenueLines, "revenueLines");
  const amount = sumSubledgerLines(revenueLines, "revenueLines");
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "invoice", amount, true),
    dueDate: input.dueDate,
    partyId: input.customerId,
    journalLines: [
      { ...input.receivableAccount, debit: amount, partyId: input.customerId },
      ...revenueLines.map((line) => ({
        ...accountReferenceOnly(line),
        credit: line.amount,
        partyId: input.customerId,
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        ...(line.description === undefined ? {} : { description: line.description }),
        dimensionRefs: line.dimensionRefs
      }))
    ],
    documentLines: revenueLines
  });
}

async function recordCustomerPayment(
  context: ServiceContext,
  input: RecordCustomerPaymentInput
): Promise<SubledgerDocumentResult> {
  const amount = normalizedPositiveMoney(input.amount, "amount");
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "customer_payment", amount, true),
    partyId: input.customerId,
    journalLines: [
      { ...input.cashAccount, debit: amount, partyId: input.customerId },
      { ...input.receivableAccount, credit: amount, partyId: input.customerId }
    ]
  });
}

async function issueCreditMemo(
  context: ServiceContext,
  input: IssueCreditMemoInput
): Promise<SubledgerDocumentResult> {
  const revenueLineInput: readonly SubledgerAmountLine[] | undefined = input.revenueLines;
  const legacyAmount: DecimalString | undefined = input.amount;
  const legacyRevenueAccount: ErpFinancialsAccountReference | undefined = input.revenueAccount;
  const revenueLines = revenueLineInput === undefined
    ? undefined
    : normalizeSubledgerLines(revenueLineInput, "revenueLines");
  const amount = revenueLines === undefined && legacyAmount !== undefined
    ? normalizedPositiveMoney(legacyAmount, "amount")
    : revenueLines === undefined
      ? (() => { throw new ErpFinancialsValidationError("Credit memo requires amount or revenueLines"); })()
      : sumSubledgerLines(revenueLines, "revenueLines");
  const revenueJournalLines: readonly PostJournalEntryLineInput[] = revenueLines === undefined
    ? legacyRevenueAccount === undefined
      ? (() => { throw new ErpFinancialsValidationError("Credit memo amount requires revenueAccount"); })()
      : [{ ...legacyRevenueAccount, debit: amount, partyId: input.customerId }]
    : revenueLines.map((line): PostJournalEntryLineInput => ({
        ...accountReferenceOnly(line),
        debit: line.amount,
        partyId: input.customerId,
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        ...(line.description === undefined ? {} : { description: line.description }),
        dimensionRefs: line.dimensionRefs
      }));
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "credit_memo", amount, true),
    partyId: input.customerId,
    journalLines: [
      ...revenueJournalLines,
      { ...input.receivableAccount, credit: amount, partyId: input.customerId }
    ],
    ...(revenueLines === undefined ? {} : { documentLines: revenueLines })
  });
}

async function issueRefund(context: ServiceContext, input: IssueRefundInput): Promise<SubledgerDocumentResult> {
  const amount = normalizedPositiveMoney(input.amount, "amount");
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "refund", amount, false),
    partyId: input.customerId,
    journalLines: [
      { ...input.receivableAccount, debit: amount, partyId: input.customerId },
      { ...input.cashAccount, credit: amount, partyId: input.customerId }
    ]
  });
}

async function createVendorBill(
  context: ServiceContext,
  input: CreateVendorBillInput
): Promise<SubledgerDocumentResult> {
  const expenseLines = normalizeSubledgerLines(input.expenseLines, "expenseLines");
  const amount = sumSubledgerLines(expenseLines, "expenseLines");
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "vendor_bill", amount, true),
    dueDate: input.dueDate,
    partyId: input.vendorId,
    journalLines: [
      ...expenseLines.map((line) => ({
        ...accountReferenceOnly(line),
        debit: line.amount,
        partyId: input.vendorId,
        ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
        ...(line.description === undefined ? {} : { description: line.description }),
        dimensionRefs: line.dimensionRefs
      })),
      { ...input.payableAccount, credit: amount, partyId: input.vendorId }
    ],
    documentLines: expenseLines
  });
}

async function recordBillPayment(
  context: ServiceContext,
  input: RecordBillPaymentInput
): Promise<SubledgerDocumentResult> {
  const amount = normalizedPositiveMoney(input.amount, "amount");
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "bill_payment", amount, true),
    partyId: input.vendorId,
    journalLines: [
      { ...input.payableAccount, debit: amount, partyId: input.vendorId },
      { ...input.cashAccount, credit: amount, partyId: input.vendorId }
    ]
  });
}

async function recordWriteOff(context: ServiceContext, input: RecordWriteOffInput): Promise<SubledgerDocumentResult> {
  const amount = normalizedPositiveMoney(input.amount, "amount");
  const journalLines: readonly PostJournalEntryLineInput[] =
    input.balanceType === "receivable"
      ? [
          { ...input.writeOffAccount, debit: amount, partyId: input.partyId },
          { ...input.balanceAccount, credit: amount, partyId: input.partyId }
        ]
      : [
          { ...input.balanceAccount, debit: amount, partyId: input.partyId },
          { ...input.writeOffAccount, credit: amount, partyId: input.partyId }
        ];
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "write_off", amount, false),
    partyId: input.partyId,
    journalLines
  });
}

async function recordDeposit(context: ServiceContext, input: RecordDepositInput): Promise<SubledgerDocumentResult> {
  const amount = normalizedPositiveMoney(input.amount, "amount");
  assertDistinctAccounts(context, input.bankAccount, input.clearingAccount, "Deposit bank and clearing accounts");
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "deposit", amount, false),
    journalLines: [
      { ...input.bankAccount, debit: amount },
      { ...input.clearingAccount, credit: amount }
    ]
  });
}

async function recordTransfer(context: ServiceContext, input: RecordTransferInput): Promise<SubledgerDocumentResult> {
  const amount = normalizedPositiveMoney(input.amount, "amount");
  assertDistinctAccounts(context, input.fromAccount, input.toAccount, "Transfer source and destination accounts");
  return createSubledgerDocument(context, {
    ...commonSubledgerDocument(context, input, "transfer", amount, false),
    journalLines: [
      { ...input.toAccount, debit: amount },
      { ...input.fromAccount, credit: amount }
    ]
  });
}

function commonSubledgerDocument(
  context: ServiceContext,
  input: SubledgerDocumentInputCommon,
  documentType: SubledgerDocumentType,
  amount: DecimalString,
  documentStartsOpen: boolean
): Omit<SubledgerDocumentWrite, "journalLines"> {
  assertFinancialOperationContext(input.operation);
  assertNonEmpty(input.idempotencyKey, "idempotencyKey");
  assertIsoDate(input.date, "date");
  const currencyCode = input.currencyCode ?? context.currencyCode;
  assertCurrencyAllowed(context, currencyCode);
  return {
    documentType,
    idempotencyKey: input.idempotencyKey,
    date: input.date,
    ...(input.documentNumber === undefined ? {} : { documentNumber: input.documentNumber }),
    currencyCode,
    amount,
    documentStartsOpen,
    metadata: {},
    ...(input.memo === undefined ? {} : { memo: input.memo }),
    operation: input.operation
  };
}

async function createSubledgerDocument(
  context: ServiceContext,
  input: SubledgerDocumentWrite
): Promise<SubledgerDocumentResult> {
  assertFinancialOperationContext(input.operation);
  assertIsoDate(input.date, "date");
  if (input.dueDate !== undefined) {
    assertIsoDate(input.dueDate, "dueDate");
    if (input.dueDate < input.date) {
      throw new ErpFinancialsValidationError("dueDate must be on or after date");
    }
  }
  const documentId = scopedRecordId(context, "subledger_document", `${input.documentType}:${input.idempotencyKey}`);
  const journalInput: InternalPostJournalEntryInput = {
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    date: input.date,
    ...(input.documentNumber === undefined ? {} : { transactionNumber: input.documentNumber }),
    ...(input.memo === undefined ? {} : { memo: input.memo }),
    currencyCode: input.currencyCode,
    lines: input.journalLines,
    nativeTransactionType: subledgerTransactionType(input.documentType),
    lifecycleAggregateType: "subledger_document",
    lifecycleEventType: `subledger.${input.documentType}.posted`,
    ...(input.partyId === undefined ? {} : { nativePartyId: input.partyId })
  };
  const journal = normalizeJournalEntry(context, journalInput);
  const identities = journalIdentities(context, journal);

  return context.database.transaction(async (client) => {
    await acquireTransactionLock(
      client,
      `subledger-document:${context.tenantId}:${context.companyId}:${context.sourceId}:${input.idempotencyKey}`
    );
    await assertCompanySourceScope(client, context);
    await assertSubledgerParty(client, context, input.partyId, input.documentType);
    const posted = await executePostJournalEntryInTransaction(client, context, journalInput, journal, identities);
    const openAmount = input.documentStartsOpen ? input.amount : "0.00";
    const documentStatus = input.documentStartsOpen ? "open" : "settled";
    const insert = await client.query(
      `insert into "erp_financials"."subledger_documents" (
  "subledger_document_id", "tenant_id", "company_id", "source_id", "document_type", "transaction_id",
  "party_id", "document_number", "document_date", "due_date", "currency_code", "original_amount", "open_amount",
  "status", "version", "idempotency_key", "lifecycle_event_id", "metadata", "created_at", "updated_at"
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, $15, $16, $17, $18, $18)
on conflict ("tenant_id", "company_id", "source_id", "idempotency_key") do nothing
returning *`,
      [
        documentId,
        context.tenantId,
        context.companyId,
        context.sourceId,
        input.documentType,
        posted.transactionId,
        input.partyId,
        input.documentNumber,
        input.date,
        input.dueDate,
        input.currencyCode,
        input.amount,
        openAmount,
        documentStatus,
        input.idempotencyKey,
        posted.lifecycleEventId,
        JSON.stringify(input.metadata),
        context.now()
      ]
    );
    const inserted = insert.rows[0];
    if (inserted !== undefined) {
      if (input.documentLines !== undefined) {
        await writeSubledgerDocumentLines(client, context, documentId, input.documentLines);
      }
      await appendSubledgerDocumentOutboxEvent(client, context, input, documentId, posted.transactionId);
      return documentResult(inserted, posted);
    }
    const existing = await loadSubledgerDocumentByIdempotencyKey(client, context, input.idempotencyKey);
    if (
      storedString(existing.subledger_document_id, "subledger_document_id") !== documentId ||
      storedString(existing.document_type, "document_type") !== input.documentType ||
      storedString(existing.transaction_id, "transaction_id") !== posted.transactionId ||
      storedMoney(existing.original_amount, "original_amount") !== input.amount ||
      storedDate(existing.document_date, "document_date") !== input.date ||
      storedOptionalDate(existing.due_date, "due_date") !== input.dueDate ||
      storedOptionalString(existing.document_number) !== input.documentNumber ||
      storedOptionalString(existing.party_id) !== input.partyId ||
      storedString(existing.currency_code, "currency_code") !== input.currencyCode
    ) {
      throw new ErpFinancialsIdempotencyConflictError(input.idempotencyKey);
    }
    await appendSubledgerDocumentOutboxEvent(client, context, input, documentId, posted.transactionId);
    return documentResult(existing, { ...posted, status: "already_posted" });
  });
}

async function appendSubledgerDocumentOutboxEvent(
  client: PostgresQueryClient,
  context: ServiceContext,
  input: SubledgerDocumentWrite,
  documentId: string,
  transactionId: string
): Promise<void> {
  await appendServiceOutboxEvent(client, context, {
    eventType: `subledger_document.${input.documentType}.posted`,
    aggregateType: "subledger_document",
    aggregateId: documentId,
    idempotencyKey: `subledger-document:${input.idempotencyKey}:outbox:posted`,
    payload: { documentId, documentType: input.documentType, transactionId }
  });
}

async function writeSubledgerDocumentLines(
  client: PostgresQueryClient,
  context: ServiceContext,
  documentId: string,
  lines: readonly (ErpFinancialsAccountReference & NormalizedCommercialDocumentLine)[]
): Promise<void> {
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    await client.query(
      `insert into "erp_financials"."subledger_document_lines" (
  "subledger_document_line_id", "tenant_id", "company_id", "source_id", "subledger_document_id", "line_number",
  "account_id", "item_id", "description", "quantity", "unit_amount", "discount_amount", "tax_code", "tax_amount",
  "service_period_start", "service_period_end", "dimension_refs", "line_amount"
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        scopedRecordId(context, "subledger_document_line", `${documentId}:${String(lineNumber)}`),
        context.tenantId,
        context.companyId,
        context.sourceId,
        documentId,
        lineNumber,
        resolveAccountId(context, line),
        line.itemId,
        line.description,
        line.quantity,
        line.unitAmount,
        line.discountAmount,
        line.taxCode,
        line.taxAmount,
        line.servicePeriodStart,
        line.servicePeriodEnd,
        JSON.stringify(line.dimensionRefs),
        line.amount
      ]
    );
  }
}

async function applySubledgerPayment(
  context: ServiceContext,
  input: ApplySubledgerPaymentInput
): Promise<SubledgerApplicationResult> {
  assertFinancialOperationContext(input.operation);
  assertExpectedSubledgerVersion(input.expectedSourceVersion, "expectedSourceVersion");
  assertExpectedSubledgerVersion(input.expectedTargetVersion, "expectedTargetVersion");
  assertSubledgerApplicationType(input.applicationType);
  const amount = normalizedPositiveMoney(input.amount, "amount");
  assertIsoDate(input.applicationDate, "applicationDate");
  assertSubledgerMatchInput(input.match);
  const applicationId = scopedRecordId(context, "subledger_application", input.idempotencyKey);
  return context.database.transaction(async (client) => {
    await acquireTransactionLock(
      client,
      `subledger-application:${context.tenantId}:${context.companyId}:${context.sourceId}:${input.sourceDocumentId}:${input.targetDocumentId}`
    );
    await assertCompanySourceScope(client, context);
    const existing = await loadSubledgerApplicationByIdempotencyKey(client, context, input.idempotencyKey);
    if (existing !== undefined) {
      assertSameSubledgerApplication(existing, input, amount, applicationId);
      const existingStatus = storedString(existing.status, "status");
      if (existingStatus !== "applied") {
        throw new ErpFinancialsValidationError(
          `Subledger application ${applicationId} is ${existingStatus} and cannot be replayed as applied; use a new idempotency key`
        );
      }
      return applicationResult(existing, "already_applied");
    }
    const [source, target] = await loadSubledgerDocumentsForUpdate(client, context, [
      input.sourceDocumentId,
      input.targetDocumentId
    ]);
    assertSubledgerApplicationDocuments(input, source, target, amount);
    if (input.match !== undefined) {
      await assertAcceptedSubledgerMatch(client, context, { ...input, match: input.match }, source, target);
    }
    const lifecycle = await appendFinancialLifecycleEvent(client, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      sourceId: context.sourceId,
      aggregateType: "subledger_application",
      aggregateId: applicationId,
      eventType: "subledger_application.applied",
      idempotencyKey: `subledger-application:${input.idempotencyKey}:applied`,
      operation: input.operation,
      recordedAt: context.now(),
      payload: {
        applicationDate: input.applicationDate,
        applicationType: input.applicationType,
        appliedAmount: amount,
        sourceDocumentId: input.sourceDocumentId,
        targetDocumentId: input.targetDocumentId,
        ...(input.match === undefined
          ? {}
          : {
              matchCandidateId: input.match.matchCandidateId,
              matchDecisionId: input.match.matchDecisionId,
              matchMethod: input.match.method,
              matchScore: input.match.score
            })
      }
    });
    const inserted = await client.query(
      `insert into "erp_financials"."subledger_applications" (
  "subledger_application_id", "tenant_id", "company_id", "source_id", "application_type", "source_document_id",
  "target_document_id", "applied_amount", "currency_code", "application_date", "status", "version",
  "idempotency_key", "applied_event_id", "ended_event_id", "match_candidate_id", "match_decision_id", "match_method",
  "match_score", "match_evidence", "created_at", "updated_at"
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'applied', 1, $11, $12, null, $13, $14, $15, $16, $17, $18, $18)
returning *`,
      [
        applicationId,
        context.tenantId,
        context.companyId,
        context.sourceId,
        input.applicationType,
        input.sourceDocumentId,
        input.targetDocumentId,
        amount,
        storedString(source.currency_code, "currency_code"),
        input.applicationDate,
        input.idempotencyKey,
        lifecycle.eventId,
        input.match?.matchCandidateId,
        input.match?.matchDecisionId,
        input.match?.method,
        input.match?.score,
        input.match?.evidence === undefined ? undefined : JSON.stringify(input.match.evidence),
        context.now()
      ]
    );
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new Error("Subledger application insert did not return its row");
    }
    await appendServiceOutboxEvent(client, context, {
      eventType: "subledger_application.applied",
      aggregateType: "subledger_application",
      aggregateId: applicationId,
      idempotencyKey: `subledger-application:${input.idempotencyKey}:outbox:applied`,
      payload: {
        amount,
        applicationId,
        applicationType: input.applicationType,
        sourceDocumentId: input.sourceDocumentId,
        targetDocumentId: input.targetDocumentId
      }
    });
    return applicationResult(row, "applied");
  });
}

async function endSubledgerApplication(
  context: ServiceContext,
  input: EndSubledgerApplicationInput,
  status: "unapplied" | "voided"
): Promise<SubledgerApplicationResult> {
  assertIndependentApproval(input.operation);
  assertExpectedSubledgerVersion(input.expectedVersion, "expectedVersion");
  return context.database.transaction(async (client) => {
    await acquireTransactionLock(
      client,
      `subledger-application:${context.tenantId}:${context.companyId}:${context.sourceId}:${input.applicationId}`
    );
    const currentResult = await client.query(
      `select * from "erp_financials"."subledger_applications"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "subledger_application_id" = $4
for update`,
      [context.tenantId, context.companyId, context.sourceId, input.applicationId]
    );
    const current = currentResult.rows[0];
    if (current === undefined) {
      throw new ErpFinancialsValidationError(
        `Subledger application ${input.applicationId} does not exist in this scope`,
        "missing_document",
        { applicationId: input.applicationId }
      );
    }
    const currentStatus = storedString(current.status, "status");
    if (currentStatus === status) {
      return applicationResult(current, status);
    }
    if (currentStatus !== "applied") {
      throw new ErpFinancialsValidationError(`Subledger application is already ${currentStatus}`);
    }
    const currentVersion = storedInteger(current.version, "version");
    if (currentVersion !== input.expectedVersion) {
      throw new ErpFinancialsError(
        "optimistic_concurrency_conflict",
        `Subledger application expected version ${String(input.expectedVersion)}, found ${String(currentVersion)}`,
        { retryable: true, details: { actualVersion: currentVersion, expectedVersion: input.expectedVersion } }
      );
    }
    const lifecycle = await appendFinancialLifecycleEvent(client, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      sourceId: context.sourceId,
      aggregateType: "subledger_application",
      aggregateId: input.applicationId,
      eventType: `subledger_application.${status}`,
      idempotencyKey: `subledger-application:${input.applicationId}:${status}:v${String(currentVersion)}`,
      operation: input.operation,
      recordedAt: context.now(),
      priorEventId: storedString(current.applied_event_id, "applied_event_id"),
      payload: { priorVersion: currentVersion, status }
    });
    const updated = await client.query(
      `update "erp_financials"."subledger_applications"
set "status" = $5, "version" = "version" + 1, "ended_event_id" = $6, "updated_at" = $7
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "subledger_application_id" = $4 and "version" = $8 and "status" = 'applied'
returning *`,
      [
        context.tenantId,
        context.companyId,
        context.sourceId,
        input.applicationId,
        status,
        lifecycle.eventId,
        context.now(),
        currentVersion
      ]
    );
    const row = updated.rows[0];
    if (row === undefined) {
      throw new ErpFinancialsError("optimistic_concurrency_conflict", "Subledger application changed concurrently", {
        retryable: true,
        details: { applicationId: input.applicationId }
      });
    }
    await appendServiceOutboxEvent(client, context, {
      eventType: `subledger_application.${status}`,
      aggregateType: "subledger_application",
      aggregateId: input.applicationId,
      idempotencyKey: `subledger-application:${input.applicationId}:outbox:${status}:v${String(currentVersion)}`,
      payload: { applicationId: input.applicationId, priorVersion: currentVersion, status }
    });
    return applicationResult(row, status);
  });
}

async function assertSubledgerParty(
  client: PostgresQueryClient,
  context: ServiceContext,
  partyId: string | undefined,
  documentType: SubledgerDocumentType
): Promise<void> {
  if (partyId === undefined) {
    return;
  }
  const expectedPartyType = ["vendor_bill", "bill_payment"].includes(documentType) ? "vendor" : "customer";
  const result = await client.query(
    `select "party_type", "active" from "erp_financials"."parties"
where "tenant_id" = $1 and "source_id" = $2 and "party_id" = $3
for key share`,
    [context.tenantId, context.sourceId, partyId]
  );
  const party = result.rows[0];
  if (party === undefined || party.active !== true || party.party_type !== expectedPartyType) {
    throw new ErpFinancialsValidationError(
      `${documentType} requires an active ${expectedPartyType} in the current tenant/source scope`,
      "missing_party",
      { partyId }
    );
  }
}

async function loadSubledgerDocumentByIdempotencyKey(
  client: PostgresQueryClient,
  context: ServiceContext,
  idempotencyKey: string
): Promise<Record<string, unknown>> {
  const result = await client.query(
    `select * from "erp_financials"."subledger_documents"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "idempotency_key" = $4
for key share`,
    [context.tenantId, context.companyId, context.sourceId, idempotencyKey]
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Subledger document idempotency row ${idempotencyKey} was not found`);
  }
  return row;
}

async function loadSubledgerApplicationByIdempotencyKey(
  client: PostgresQueryClient,
  context: ServiceContext,
  idempotencyKey: string
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(
    `select * from "erp_financials"."subledger_applications"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "idempotency_key" = $4
for key share`,
    [context.tenantId, context.companyId, context.sourceId, idempotencyKey]
  );
  return result.rows[0];
}

async function loadSubledgerDocumentsForUpdate(
  client: PostgresQueryClient,
  context: ServiceContext,
  ids: readonly [string, string]
): Promise<readonly [Record<string, unknown>, Record<string, unknown>]> {
  if (ids[0] === ids[1]) {
    throw new ErpFinancialsValidationError("Subledger application source and target documents must differ");
  }
  const result = await client.query(
    `select * from "erp_financials"."subledger_documents"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "subledger_document_id" = any($4::text[])
order by "subledger_document_id"
for update`,
    [context.tenantId, context.companyId, context.sourceId, [...ids].sort()]
  );
  const byId = new Map(result.rows.map((row) => [storedString(row.subledger_document_id, "subledger_document_id"), row]));
  const source = byId.get(ids[0]);
  const target = byId.get(ids[1]);
  if (source === undefined || target === undefined) {
    throw new ErpFinancialsValidationError(
      "Both subledger application documents must exist in the current scope",
      "missing_document"
    );
  }
  return [source, target];
}

function assertSubledgerApplicationDocuments(
  input: ApplySubledgerPaymentInput,
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  amount: DecimalString
): void {
  const expectedTypes: Record<SubledgerApplicationType, readonly [SubledgerDocumentType, SubledgerDocumentType]> = {
    customer_payment_to_invoice: ["customer_payment", "invoice"],
    bill_payment_to_bill: ["bill_payment", "vendor_bill"],
    credit_to_invoice: ["credit_memo", "invoice"]
  };
  const types = expectedTypes[input.applicationType];
  if (source.document_type !== types[0] || target.document_type !== types[1]) {
    throw new ErpFinancialsValidationError("Application documents do not match applicationType");
  }
  if (source.party_id == null || source.party_id !== target.party_id) {
    throw new ErpFinancialsValidationError("Application documents must have the same non-null party");
  }
  if (source.currency_code !== target.currency_code) {
    throw new ErpFinancialsValidationError("Application documents must use the same currency");
  }
  if (storedInteger(source.version, "source.version") !== input.expectedSourceVersion) {
    throw new ErpFinancialsError("optimistic_concurrency_conflict", "Source document version changed concurrently", {
      retryable: true,
      details: { documentId: input.sourceDocumentId, expectedVersion: input.expectedSourceVersion }
    });
  }
  if (storedInteger(target.version, "target.version") !== input.expectedTargetVersion) {
    throw new ErpFinancialsError("optimistic_concurrency_conflict", "Target document version changed concurrently", {
      retryable: true,
      details: { documentId: input.targetDocumentId, expectedVersion: input.expectedTargetVersion }
    });
  }
  const amountMinor = parsePositiveMoney(amount, "amount");
  if (
    amountMinor > parsePositiveOrZeroMoney(source.open_amount, "source.open_amount") ||
    amountMinor > parsePositiveOrZeroMoney(target.open_amount, "target.open_amount")
  ) {
    throw new ErpFinancialsValidationError("Application amount exceeds an available document balance");
  }
}

function assertSubledgerMatchInput(match: ApplySubledgerPaymentInput["match"]): void {
  if (match === undefined) return;
  assertNonEmpty(match.matchCandidateId, "match.matchCandidateId");
  assertNonEmpty(match.matchDecisionId, "match.matchDecisionId");
  const method: unknown = match.method;
  if (method !== "automatic" && method !== "manual") {
    throw new ErpFinancialsValidationError("match.method must be automatic or manual");
  }
  if (!/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/u.test(match.score)) {
    throw new ErpFinancialsValidationError("match.score must be between 0 and 1 with at most six fractional digits");
  }
  if (match.evidence !== undefined) {
    assertNoCredentialKeys(match.evidence);
    if (Buffer.byteLength(JSON.stringify(match.evidence), "utf8") > 4096) {
      throw new ErpFinancialsValidationError("match.evidence exceeds 4096 bytes");
    }
  }
}

async function assertAcceptedSubledgerMatch(
  client: PostgresQueryClient,
  context: ServiceContext,
  input: ApplySubledgerPaymentInput & { readonly match: NonNullable<ApplySubledgerPaymentInput["match"]> },
  source: Readonly<Record<string, unknown>>,
  target: Readonly<Record<string, unknown>>
): Promise<void> {
  const result = await client.query(
    `select candidate."match_kind", candidate."origin_transaction_id", candidate."target_transaction_id", candidate."score" as "candidate_score",
  candidate."suggested_application_amount",
  candidate."currency_code", candidate."status" as "candidate_status", candidate."expires_at",
  decision."decision", decision."method", decision."evidence" as "decision_evidence"
from "erp_financials"."transaction_match_candidates" candidate
join "erp_financials"."transaction_match_decisions" decision
  on decision."tenant_id" = candidate."tenant_id" and decision."source_id" = candidate."source_id"
 and decision."match_candidate_id" = candidate."match_candidate_id"
where candidate."tenant_id" = $1 and candidate."source_id" = $2 and candidate."match_candidate_id" = $3
  and decision."match_decision_id" = $4
for key share of candidate, decision`,
    [context.tenantId, context.sourceId, input.match.matchCandidateId, input.match.matchDecisionId]
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ErpFinancialsValidationError("Accepted match candidate and decision do not exist in this scope", "missing_document");
  }
  const expectedKind =
    input.applicationType === "customer_payment_to_invoice"
      ? "customer_payment_to_invoice"
      : input.applicationType === "bill_payment_to_bill"
        ? "vendor_payment_to_bill"
        : undefined;
  if (expectedKind === undefined) {
    throw new ErpFinancialsValidationError("Credit applications cannot reference a payment match candidate");
  }
  const candidateStatus = storedString(row.candidate_status, "candidate_status");
  if (
    storedString(row.match_kind, "match_kind") !== expectedKind ||
    storedString(row.origin_transaction_id, "origin_transaction_id") !== storedString(source.transaction_id, "source.transaction_id") ||
    storedString(row.target_transaction_id, "target_transaction_id") !== storedString(target.transaction_id, "target.transaction_id") ||
    storedString(row.currency_code, "currency_code") !== storedString(source.currency_code, "source.currency_code") ||
    normalizedPositiveMoney(
      storedDecimal(row.suggested_application_amount, "suggested_application_amount"),
      "suggested_application_amount"
    ) !== normalizedPositiveMoney(input.amount, "amount") ||
    storedString(row.decision, "decision") !== "accepted" ||
    storedString(row.method, "method") !== input.match.method ||
    !unitDecimalsEqual(storedDecimal(row.candidate_score, "candidate_score"), input.match.score) ||
    stableJson(storedJson(row.decision_evidence)) !== stableJson(input.match.evidence ?? null) ||
    ["rejected", "expired", "superseded"].includes(candidateStatus)
  ) {
    throw new ErpFinancialsValidationError("Match evidence is not valid for these application documents", "scope_mismatch");
  }
  const expiresAt = row.expires_at instanceof Date ? row.expires_at.toISOString() : storedOptionalString(row.expires_at);
  if (expiresAt !== undefined && expiresAt.slice(0, 10) < input.applicationDate) {
    throw new ErpFinancialsValidationError("Match candidate expired before the application date", "terminal_state_conflict");
  }
  await client.query(
    `update "erp_financials"."transaction_match_candidates"
set "status" = 'accepted'
where "tenant_id" = $1 and "source_id" = $2 and "match_candidate_id" = $3 and "status" in ('suggested', 'accepted')`,
    [context.tenantId, context.sourceId, input.match.matchCandidateId]
  );
}

function assertSameSubledgerApplication(
  existing: Record<string, unknown>,
  input: ApplySubledgerPaymentInput,
  amount: DecimalString,
  applicationId: string
): void {
  if (
    existing.subledger_application_id !== applicationId ||
    existing.application_type !== input.applicationType ||
    existing.source_document_id !== input.sourceDocumentId ||
    existing.target_document_id !== input.targetDocumentId ||
    storedMoney(existing.applied_amount, "applied_amount") !== amount ||
    storedDate(existing.application_date, "application_date") !== input.applicationDate ||
    storedOptionalString(existing.match_candidate_id) !== input.match?.matchCandidateId ||
    storedOptionalString(existing.match_decision_id) !== input.match?.matchDecisionId ||
    storedOptionalString(existing.match_method) !== input.match?.method ||
    (existing.match_score === null || existing.match_score === undefined
      ? undefined
      : storedDecimal(existing.match_score, "match_score")) !== input.match?.score ||
    stableJson(existing.match_evidence ?? null) !== stableJson(input.match?.evidence ?? null)
  ) {
    throw new ErpFinancialsIdempotencyConflictError(input.idempotencyKey);
  }
}

function documentResult(row: Record<string, unknown>, journal: PostJournalEntryResult): SubledgerDocumentResult {
  const documentStatus = storedString(row.status, "status");
  if (!["open", "partially_applied", "settled", "voided"].includes(documentStatus)) {
    throw new Error(`New subledger document has unexpected status ${documentStatus}`);
  }
  return {
    status: journal.status,
    documentId: storedString(row.subledger_document_id, "subledger_document_id"),
    documentType: storedString(row.document_type, "document_type") as SubledgerDocumentType,
    originalAmount: storedMoney(row.original_amount, "original_amount"),
    openAmount: storedMoney(row.open_amount, "open_amount"),
    documentStatus: documentStatus as SubledgerDocumentResult["documentStatus"],
    version: storedInteger(row.version, "version"),
    journal
  };
}

function applicationResult(
  row: Record<string, unknown>,
  status: SubledgerApplicationResult["status"]
): SubledgerApplicationResult {
  const matchCandidateId = storedOptionalString(row.match_candidate_id);
  const matchDecisionId = storedOptionalString(row.match_decision_id);
  const matchMethod = storedOptionalString(row.match_method) as "automatic" | "manual" | undefined;
  const matchScore = row.match_score === null || row.match_score === undefined
    ? undefined
    : storedDecimal(row.match_score, "match_score");
  return {
    status,
    applicationId: storedString(row.subledger_application_id, "subledger_application_id"),
    version: storedInteger(row.version, "version"),
    sourceDocumentId: storedString(row.source_document_id, "source_document_id"),
    targetDocumentId: storedString(row.target_document_id, "target_document_id"),
    appliedAmount: storedMoney(row.applied_amount, "applied_amount"),
    currencyCode: storedString(row.currency_code, "currency_code"),
    ...(matchCandidateId === undefined ? {} : { matchCandidateId }),
    ...(matchDecisionId === undefined ? {} : { matchDecisionId }),
    ...(matchMethod === undefined ? {} : { matchMethod }),
    ...(matchScore === undefined ? {} : { matchScore }),
    lifecycleEventId: storedString(
      row.ended_event_id ?? row.applied_event_id,
      row.ended_event_id == null ? "applied_event_id" : "ended_event_id"
    )
  };
}

function storedDecimal(value: unknown, field: string): DecimalString {
  const decimal = typeof value === "number" ? String(value) : storedString(value, field);
  if (!/^-?\d+(?:\.\d+)?$/u.test(decimal)) throw new Error(`Stored field ${field} must be a decimal`);
  return decimal;
}

function storedJson(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  return (typeof value === "string" ? JSON.parse(value) : value) as JsonValue;
}

function unitDecimalsEqual(left: DecimalString, right: DecimalString): boolean {
  const scaled = (value: string): bigint => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  };
  return scaled(left) === scaled(right);
}

function subledgerTransactionType(documentType: SubledgerDocumentType): string {
  return `Subledger:${documentType}`;
}

function sumSubledgerLines(lines: readonly SubledgerAmountLine[], field: string): DecimalString {
  if (lines.length === 0) {
    throw new ErpFinancialsValidationError(`${field} must contain at least one line`);
  }
  return formatMoney(
    lines.reduce((sum, line, index) => sum + parsePositiveMoney(line.amount, `${field}[${String(index)}].amount`), 0n)
  );
}

function normalizeSubledgerLines(
  lines: readonly SubledgerAmountLine[],
  field: string
): readonly (ErpFinancialsAccountReference & NormalizedCommercialDocumentLine)[] {
  if (lines.length === 0) {
    throw new ErpFinancialsValidationError(`${field} must contain at least one line`);
  }
  return lines.map((line, index) => ({
    ...accountReferenceOnly(line),
    ...normalizeCommercialDocumentLine(line, `${field}[${String(index)}]`)
  }));
}

function accountReferenceOnly(line: SubledgerAmountLine): ErpFinancialsAccountReference {
  return line.accountKey !== undefined ? { accountKey: line.accountKey } : { accountId: line.accountId };
}

function normalizedPositiveMoney(value: DecimalString, field: string): DecimalString {
  return formatMoney(parsePositiveMoney(value, field));
}

function assertDistinctAccounts(
  context: ServiceContext,
  left: ErpFinancialsAccountReference,
  right: ErpFinancialsAccountReference,
  label: string
): void {
  if (resolveAccountId(context, left) === resolveAccountId(context, right)) {
    throw new ErpFinancialsValidationError(`${label} must differ`);
  }
}

function assertSubledgerApplicationType(value: SubledgerApplicationType): void {
  if (![
    "customer_payment_to_invoice",
    "bill_payment_to_bill",
    "credit_to_invoice"
  ].includes(value)) {
    throw new ErpFinancialsValidationError(`Unsupported subledger application type ${value}`);
  }
}

function parsePositiveOrZeroMoney(value: unknown, field: string): bigint {
  const money = typeof value === "number" ? value.toFixed(2) : value;
  if (typeof money !== "string" || !/^\d+(?:\.\d{1,2})?$/u.test(money)) {
    throw new Error(`${field} must be nonnegative fixed-scale money`);
  }
  const [whole, fraction = ""] = money.split(".");
  return BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0"));
}

function assertExpectedSubledgerVersion(version: number, field: string): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new ErpFinancialsValidationError(`${field} must be a positive integer`);
  }
}

function storedInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed)) {
    throw new Error(`Stored field ${field} must be an integer`);
  }
  return parsed;
}

type LoadedPostedJournal = {
  readonly transactionId: string;
  readonly memo?: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly accountingBasis: AccountingBasis;
  readonly lines: readonly PostJournalEntryLineInput[];
  readonly postedLifecycleEventId?: string;
};

async function runJournalLifecycleWorkflow(
  context: ServiceContext,
  outcome: JournalEntryLifecycleResult["outcome"],
  input: ReverseJournalEntryInput | ReplaceJournalEntryInput
): Promise<JournalEntryLifecycleResult> {
  assertIndependentApproval(input.operation);
  assertNonEmpty(input.originalTransactionId, "originalTransactionId");
  assertNonEmpty(input.idempotencyKey, "idempotencyKey");
  assertIsoDate(input.date, "date");
  if ((outcome === "corrected" || outcome === "replaced") && !("replacement" in input)) {
    throw new ErpFinancialsValidationError(`${outcome} journal workflow requires a replacement journal`);
  }

  return context.database.transaction(async (client) => {
    await acquireTransactionLock(
      client,
      `journal-lifecycle:${context.tenantId}:${context.sourceId}:${input.originalTransactionId}`
    );
    await assertCompanySourceScope(client, context);
    const original = await loadPostedJournalForLifecycle(client, context, input.originalTransactionId);
    const reversalInput: PostJournalEntryInput = {
      operation: input.operation,
      idempotencyKey: `${input.idempotencyKey}:reversal`,
      date: input.date,
      memo: input.memo ?? `${outcome} ${original.transactionId}`,
      currencyCode: original.currencyCode,
      accountingBasis: original.accountingBasis,
      adjustment: true,
      lines: original.lines
    };
    const reversalJournal = normalizeJournalEntry(context, reversalInput);
    const reversalIdentities = journalIdentities(context, reversalJournal);
    const reversalLinkType = outcome === "voided" ? "void" : "reversal";
    await assertJournalLifecycleSlotAvailable(client, context, {
      originalTransactionId: original.transactionId,
      expectedRelatedTransactionId: reversalIdentities.transactionId,
      expectedLinkType: reversalLinkType,
      competingLinkTypes: ["reversal", "void"]
    });
    await acquireTransactionLock(
      client,
      `journal-entry:${context.tenantId}:${context.sourceId}:${reversalJournal.idempotencyKey}`
    );
    const reversal = await executePostJournalEntryInTransaction(
      client,
      context,
      reversalInput,
      reversalJournal,
      reversalIdentities
    );
    const reversalLink = await appendJournalEntryLink(client, context, {
      originalTransactionId: original.transactionId,
      relatedTransactionId: reversal.transactionId,
      linkType: reversalLinkType,
      eventType: outcome === "voided" ? "journal_entry.voided" : "journal_entry.reversed",
      idempotencyKey: `${input.idempotencyKey}:${reversalLinkType}`,
      operation: input.operation,
      ...(original.postedLifecycleEventId === undefined ? {} : { priorEventId: original.postedLifecycleEventId })
    });

    if (outcome !== "corrected" && outcome !== "replaced") {
      return {
        outcome,
        originalTransactionId: original.transactionId,
        reversal,
        journalEntryLinkIds: [reversalLink.linkId],
        lifecycleEventIds: [reversal.lifecycleEventId, reversalLink.eventId]
      };
    }

    const replacementDefinition = (input as ReplaceJournalEntryInput).replacement;
    const replacementInput: PostJournalEntryInput = {
      ...replacementDefinition,
      operation: input.operation,
      adjustment: true
    };
    const replacementJournal = normalizeJournalEntry(context, replacementInput);
    const replacementIdentities = journalIdentities(context, replacementJournal);
    const replacementLinkType = outcome === "corrected" ? "correction" : "replacement";
    await assertJournalLifecycleSlotAvailable(client, context, {
      originalTransactionId: original.transactionId,
      expectedRelatedTransactionId: replacementIdentities.transactionId,
      expectedLinkType: replacementLinkType,
      competingLinkTypes: ["correction", "replacement"]
    });
    await acquireTransactionLock(
      client,
      `journal-entry:${context.tenantId}:${context.sourceId}:${replacementJournal.idempotencyKey}`
    );
    const replacement = await executePostJournalEntryInTransaction(
      client,
      context,
      replacementInput,
      replacementJournal,
      replacementIdentities
    );
    const replacementLink = await appendJournalEntryLink(client, context, {
      originalTransactionId: original.transactionId,
      relatedTransactionId: replacement.transactionId,
      linkType: replacementLinkType,
      eventType: outcome === "corrected" ? "journal_entry.corrected" : "journal_entry.replaced",
      idempotencyKey: `${input.idempotencyKey}:${replacementLinkType}`,
      operation: input.operation,
      priorEventId: reversalLink.eventId
    });

    return {
      outcome,
      originalTransactionId: original.transactionId,
      reversal,
      replacement,
      journalEntryLinkIds: [reversalLink.linkId, replacementLink.linkId],
      lifecycleEventIds: [
        reversal.lifecycleEventId,
        reversalLink.eventId,
        replacement.lifecycleEventId,
        replacementLink.eventId
      ]
    };
  });
}

async function assertJournalLifecycleSlotAvailable(
  client: PostgresQueryClient,
  context: ServiceContext,
  input: {
    readonly originalTransactionId: string;
    readonly expectedRelatedTransactionId: string;
    readonly expectedLinkType: "reversal" | "void" | "correction" | "replacement";
    readonly competingLinkTypes: readonly ("reversal" | "void" | "correction" | "replacement")[];
  }
): Promise<void> {
  const result = await client.query(
    `select "related_transaction_id", "link_type"
from "erp_financials"."journal_entry_links"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3 and "original_transaction_id" = $4
  and "link_type" = any($5::text[])
for key share`,
    [context.tenantId, context.companyId, context.sourceId, input.originalTransactionId, input.competingLinkTypes]
  );
  const existing = result.rows[0];
  if (existing === undefined) {
    return;
  }
  const existingRelatedTransactionId = storedString(existing.related_transaction_id, "related_transaction_id");
  const existingLinkType = storedString(existing.link_type, "link_type");
  if (
    existingRelatedTransactionId !== input.expectedRelatedTransactionId ||
    existingLinkType !== input.expectedLinkType
  ) {
    throw new ErpFinancialsValidationError(
      `Journal entry ${input.originalTransactionId} already has a terminal ${existingLinkType} workflow`
    );
  }
}

async function loadPostedJournalForLifecycle(
  client: PostgresQueryClient,
  context: ServiceContext,
  transactionId: string
): Promise<LoadedPostedJournal> {
  const result = await client.query(
    `select transactions."transaction_id", transactions."source_transaction_type", transactions."status", transactions."memo",
  postings."posting_id", postings."account_id", postings."party_id", postings."item_id",
  postings."debit_amount", postings."credit_amount", postings."currency_code", postings."accounting_basis", postings."dimension_refs"
from "erp_financials"."transactions" transactions
join "erp_financials"."ledger_postings" postings
  on postings."tenant_id" = transactions."tenant_id"
 and postings."source_id" = transactions."source_id"
 and postings."transaction_id" = transactions."transaction_id"
where transactions."tenant_id" = $1 and transactions."source_id" = $2 and transactions."transaction_id" = $3
order by postings."posting_id"
for update of transactions, postings`,
    [context.tenantId, context.sourceId, transactionId]
  );
  if (result.rows.length < 2) {
    throw new ErpFinancialsValidationError(`Posted journal ${transactionId} does not exist or has insufficient postings`);
  }
  const first = result.rows[0];
  if (first === undefined) {
    throw new Error("Posted journal query returned no first row");
  }
  const sourceType = storedString(first.source_transaction_type, "source_transaction_type");
  if (sourceType !== "JournalEntry" && sourceType !== "JournalEntryAdjustment") {
    throw new ErpFinancialsValidationError(`Transaction ${transactionId} is not a journal entry`);
  }
  if (storedString(first.status, "status") !== "posted") {
    throw new ErpFinancialsValidationError(`Journal entry ${transactionId} is not posted`);
  }
  const currencyCode = storedString(first.currency_code, "currency_code");
  const accountingBasis = storedString(first.accounting_basis, "accounting_basis") as AccountingBasis;
  assertAccountingBasis(accountingBasis);
  const lines = result.rows.map((row): PostJournalEntryLineInput => {
    if (
      storedString(row.currency_code, "currency_code") !== currencyCode ||
      storedString(row.accounting_basis, "accounting_basis") !== accountingBasis
    ) {
      throw new ErpFinancialsValidationError(`Journal entry ${transactionId} has mixed currency or accounting basis`);
    }
    const debit = storedMoney(row.debit_amount, "debit_amount");
    const credit = storedMoney(row.credit_amount, "credit_amount");
    const partyId = storedOptionalString(row.party_id);
    const itemId = storedOptionalString(row.item_id);
    const common = {
      accountId: storedString(row.account_id, "account_id"),
      lineId: storedString(row.posting_id, "posting_id"),
      ...(partyId === undefined ? {} : { partyId }),
      ...(itemId === undefined ? {} : { itemId }),
      dimensionRefs: storedDimensionRefs(row.dimension_refs)
    };
    if (debit !== "0.00" && credit === "0.00") {
      return { ...common, credit: debit };
    }
    if (credit !== "0.00" && debit === "0.00") {
      return { ...common, debit: credit };
    }
    throw new ErpFinancialsValidationError(`Journal entry ${transactionId} contains a non-single-sided posting`);
  });
  const postedLifecycleEventId = await loadPostedJournalLifecycleEventId(client, context, transactionId);
  const memo = storedOptionalString(first.memo);
  return {
    transactionId,
    ...(memo === undefined ? {} : { memo }),
    currencyCode,
    accountingBasis,
    lines,
    ...(postedLifecycleEventId === undefined ? {} : { postedLifecycleEventId })
  };
}

async function loadPostedJournalLifecycleEventId(
  client: PostgresQueryClient,
  context: ServiceContext,
  transactionId: string
): Promise<string | undefined> {
  const result = await client.query(
    `select "event_id"
from "erp_financials"."financial_lifecycle_events"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
  and "aggregate_type" = 'journal_entry' and "aggregate_id" = $4
  and "event_type" in ('journal_entry.posted', 'journal_entry.adjustment_posted')
order by "occurred_at", "event_id"
limit 1
for key share`,
    [context.tenantId, context.companyId, context.sourceId, transactionId]
  );
  return storedOptionalString(result.rows[0]?.event_id);
}

async function appendJournalEntryLink(
  client: PostgresQueryClient,
  context: ServiceContext,
  input: {
    readonly originalTransactionId: string;
    readonly relatedTransactionId: string;
    readonly linkType: "reversal" | "void" | "correction" | "replacement";
    readonly eventType: string;
    readonly idempotencyKey: string;
    readonly operation: FinancialOperationContext;
    readonly priorEventId?: string;
  }
): Promise<{ readonly linkId: string; readonly eventId: string }> {
  const linkId = scopedRecordId(
    context,
    "journal_entry_link",
    `${input.originalTransactionId}:${input.relatedTransactionId}:${input.linkType}`
  );
  const lifecycle = await appendFinancialLifecycleEvent(client, {
    tenantId: context.tenantId,
    companyId: context.companyId,
    sourceId: context.sourceId,
    aggregateType: "journal_entry",
    aggregateId: input.originalTransactionId,
    eventType: input.eventType,
    idempotencyKey: `journal-lifecycle:${input.idempotencyKey}`,
    operation: input.operation,
    recordedAt: context.now(),
    ...(input.priorEventId === undefined ? {} : { priorEventId: input.priorEventId }),
    payload: {
      linkType: input.linkType,
      originalTransactionId: input.originalTransactionId,
      relatedTransactionId: input.relatedTransactionId
    }
  });
  await client.query(
    `insert into "erp_financials"."journal_entry_links" (
  "journal_entry_link_id", "tenant_id", "company_id", "source_id", "original_transaction_id",
  "related_transaction_id", "link_type", "lifecycle_event_id", "created_at"
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
on conflict ("tenant_id", "company_id", "source_id", "original_transaction_id", "related_transaction_id", "link_type") do nothing`,
    [
      linkId,
      context.tenantId,
      context.companyId,
      context.sourceId,
      input.originalTransactionId,
      input.relatedTransactionId,
      input.linkType,
      lifecycle.eventId,
      context.now()
    ]
  );
  return { linkId, eventId: lifecycle.eventId };
}

function storedString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Stored journal field ${field} must be a non-empty string`);
  }
  return value;
}

function storedOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function storedMoney(value: unknown, field: string): DecimalString {
  const money = typeof value === "number" ? value.toFixed(2) : storedString(value, field);
  if (!/^-?\d+\.\d{2}$/u.test(money)) {
    throw new Error(`Stored journal field ${field} must be fixed-scale money`);
  }
  return money;
}

function storedDate(value: unknown, field: string): IsoDate {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : storedString(value, field);
  assertIsoDate(date, field);
  return date;
}

function storedOptionalDate(value: unknown, field: string): IsoDate | undefined {
  return value === undefined || value === null ? undefined : storedDate(value, field);
}

function storedDimensionRefs(value: unknown): readonly DimensionRef[] {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }
  if (!parsed.every(isStoredDimensionRef)) {
    throw new Error("Stored journal field dimension_refs must contain valid dimension references");
  }
  return parsed;
}

function isStoredDimensionRef(value: unknown): value is DimensionRef {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.dimensionKind === "string" &&
    ref.dimensionKind.length > 0 &&
    (ref.dimensionId === undefined || typeof ref.dimensionId === "string") &&
    (ref.sourceDimensionId === undefined || typeof ref.sourceDimensionId === "string") &&
    (ref.name === undefined || typeof ref.name === "string")
  );
}

function serviceContext(input: CreateErpFinancialsInput): ServiceContext {
  assertNonEmpty(input.tenantId, "tenantId");
  assertNonEmpty(input.companyId, "companyId");
  assertNonEmpty(input.sourceId, "sourceId");
  assertNonEmpty(input.currencyCode, "currencyCode");
  if (!/^[A-Z]{3}$/u.test(input.currencyCode)) {
    throw new ErpFinancialsValidationError("currencyCode must be a three-letter uppercase ISO currency code");
  }
  const currencyPolicy: unknown = input.currencyPolicy;
  if (currencyPolicy !== undefined && currencyPolicy !== "single_currency") {
    throw new ErpFinancialsValidationError(
      `Unsupported currency policy ${typeof currencyPolicy === "string" ? currencyPolicy : "non-string value"}`,
      "unsupported_operation"
    );
  }
  const accountingBasis = input.accountingBasis ?? "accrual";
  assertAccountingBasis(accountingBasis);

  return {
    database: isTransactionRunner(input.database)
      ? input.database
      : createPostgresTransactionRunner(input.database),
    tenantId: input.tenantId,
    companyId: input.companyId,
    sourceId: input.sourceId,
    ...(input.bookId === undefined ? {} : { bookId: input.bookId }),
    currencyCode: input.currencyCode,
    currencyPolicy: input.currencyPolicy ?? "single_currency",
    accountingBasis,
    now: input.now ?? (() => new Date().toISOString()),
    postingPolicy: input.postingPolicy ?? "enforce_fiscal_periods"
  };
}

function isTransactionRunner(database: ErpFinancialsDatabase): database is ErpFinancialsTransactionRunner {
  return "transaction" in database && typeof database.transaction === "function";
}

function flattenAccountTree(context: ServiceContext, input: UpsertAccountTreeInput): readonly Account[] {
  const accounts: Account[] = [];
  const accountIds = new Set<string>();
  const sourceAccountIds = new Set<string>();
  const visitedNodes = new Set<object>();

  const visit = (definition: ErpFinancialsAccountTreeNode, parentAccountId?: AccountId): void => {
    if (visitedNodes.has(definition)) {
      throw new ErpFinancialsValidationError("Account tree contains the same node object more than once");
    }
    visitedNodes.add(definition);

    const accountId = resolveAccountId(context, definition);
    assertNonEmpty(definition.name, `Account ${accountId} name`);
    if (!ACCOUNT_CLASSIFICATIONS.has(definition.classification)) {
      throw new ErpFinancialsValidationError(
        `Account ${accountId} has unsupported classification ${definition.classification}`
      );
    }

    const sourceAccountId = definition.sourceAccountId ?? accountReferenceKey(definition);
    assertNonEmpty(sourceAccountId, `Account ${accountId} sourceAccountId`);
    if (accountIds.has(accountId)) {
      throw new ErpFinancialsValidationError(`Account tree contains duplicate accountId ${accountId}`);
    }
    if (sourceAccountIds.has(sourceAccountId)) {
      throw new ErpFinancialsValidationError(`Account tree contains duplicate sourceAccountId ${sourceAccountId}`);
    }
    accountIds.add(accountId);
    sourceAccountIds.add(sourceAccountId);

    accounts.push({
      tenantId: context.tenantId,
      sourceId: context.sourceId,
      accountId,
      sourceAccountId,
      ...(definition.accountNumber === undefined ? {} : { accountNumber: definition.accountNumber }),
      name: definition.name,
      type: definition.type ?? definition.classification,
      ...(definition.subtype === undefined ? {} : { subtype: definition.subtype }),
      classification: definition.classification,
      ...(parentAccountId === undefined ? {} : { parentAccountId }),
      currencyCode: definition.currencyCode ?? context.currencyCode,
      active: definition.active ?? true
    });

    for (const child of definition.children ?? []) {
      visit(child, accountId);
    }
  };

  visit({
    ...input.parent,
    ...(input.children === undefined ? {} : { children: input.children })
  });
  return accounts;
}

function assertAccountIdentitiesAreStable(existingAccounts: readonly Account[], accounts: readonly Account[]): void {
  const existingById = new Map(existingAccounts.map((account) => [account.accountId, account]));
  const existingBySourceId = new Map(existingAccounts.map((account) => [account.sourceAccountId, account]));

  for (const account of accounts) {
    const existingWithId = existingById.get(account.accountId);
    if (existingWithId !== undefined && existingWithId.sourceAccountId !== account.sourceAccountId) {
      throw new ErpFinancialsValidationError(
        `Account ${account.accountId} cannot change sourceAccountId from ${existingWithId.sourceAccountId} to ${account.sourceAccountId}`
      );
    }

    const existingWithSourceId = existingBySourceId.get(account.sourceAccountId);
    if (existingWithSourceId !== undefined && existingWithSourceId.accountId !== account.accountId) {
      throw new ErpFinancialsValidationError(
        `sourceAccountId ${account.sourceAccountId} is already assigned to account ${existingWithSourceId.accountId}`
      );
    }
  }
}

function normalizeJournalEntry(context: ServiceContext, input: InternalPostJournalEntryInput): NormalizedJournalEntry {
  assertNonEmpty(input.idempotencyKey, "idempotencyKey");
  assertIsoDate(input.date, "date");
  if (input.lines.length < 2) {
    throw new ErpFinancialsValidationError("A journal entry requires at least two lines");
  }

  const lineIds = new Set<string>();
  const lines = input.lines.map((line, index): NormalizedJournalLine => {
    const accountId = resolveAccountId(context, line);
    const lineId = line.lineId ?? String(index + 1);
    assertNonEmpty(lineId, `Journal line ${String(index + 1)} lineId`);
    if (lineIds.has(lineId)) {
      throw new ErpFinancialsValidationError(`Journal entry contains duplicate lineId ${lineId}`);
    }
    lineIds.add(lineId);

    const debit = (line as { readonly debit?: unknown }).debit;
    const credit = (line as { readonly credit?: unknown }).credit;
    if ((debit === undefined) === (credit === undefined)) {
      throw new ErpFinancialsValidationError(`Journal line ${lineId} must have exactly one of debit or credit`);
    }

    const debitMinor = debit === undefined ? 0n : parsePositiveMoney(debit, `Journal line ${lineId} debit`);
    const creditMinor = credit === undefined ? 0n : parsePositiveMoney(credit, `Journal line ${lineId} credit`);

    return {
      accountId,
      lineId,
      lineNumber: index + 1,
      debitMinor,
      creditMinor,
      debitAmount: formatMoney(debitMinor),
      creditAmount: formatMoney(creditMinor),
      ...(line.description === undefined ? {} : { description: line.description }),
      ...(line.partyId === undefined ? {} : { partyId: line.partyId }),
      ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
      dimensionRefs: line.dimensionRefs ?? []
    };
  });

  const debitMinor = lines.reduce((sum, line) => sum + line.debitMinor, 0n);
  const creditMinor = lines.reduce((sum, line) => sum + line.creditMinor, 0n);
  if (debitMinor !== creditMinor) {
    throw new ErpFinancialsValidationError(
      `Journal entry is unbalanced: debits ${formatMoney(debitMinor)}, credits ${formatMoney(creditMinor)}`,
      "posting_unbalanced",
      { totalCredits: formatMoney(creditMinor), totalDebits: formatMoney(debitMinor) }
    );
  }

  const currencyCode = input.currencyCode ?? context.currencyCode;
  assertCurrencyAllowed(context, currencyCode);
  const accountingBasis = input.accountingBasis ?? context.accountingBasis;
  const sourceTransactionType =
    input.nativeTransactionType ?? (input.adjustment === true ? "JournalEntryAdjustment" : "JournalEntry");
  const lifecycleAggregateType = input.lifecycleAggregateType ?? "journal_entry";
  const lifecycleEventType =
    input.lifecycleEventType ??
    (input.adjustment === true ? "journal_entry.adjustment_posted" : "journal_entry.posted");
  assertNonEmpty(currencyCode, "currencyCode");
  assertAccountingBasis(accountingBasis);
  if (input.postedAt !== undefined) {
    assertIsoDateTime(input.postedAt, "postedAt");
  }

  const checksum = createHash("sha256")
    .update(
      stableJson({
        accountingBasis,
        adjustment: input.adjustment === true,
        currencyCode,
        date: input.date,
        idempotencyKey: input.idempotencyKey,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          creditAmount: line.creditAmount,
          debitAmount: line.debitAmount,
          description: line.description ?? null,
          dimensionHash: createDimensionHash(line.dimensionRefs),
          itemId: line.itemId ?? null,
          lineId: line.lineId,
          partyId: line.partyId ?? null
        })),
        memo: input.memo ?? null,
        postedAt: input.postedAt ?? null,
        transactionNumber: input.transactionNumber ?? null
        ,
        sourceTransactionType,
        partyId: input.nativePartyId ?? null
      })
    )
    .digest("hex");

  return {
    idempotencyKey: input.idempotencyKey,
    date: input.date,
    ...(input.transactionNumber === undefined ? {} : { transactionNumber: input.transactionNumber }),
    ...(input.memo === undefined ? {} : { memo: input.memo }),
    ...(input.postedAt === undefined ? {} : { postedAt: input.postedAt }),
    currencyCode,
    accountingBasis,
    lines,
    checksum,
    staleReason: input.staleReason ?? JOURNAL_ENTRY_POSTED_STALE_REASON,
    adjustment: input.adjustment === true,
    sourceTransactionType,
    lifecycleAggregateType,
    lifecycleEventType,
    ...(input.nativePartyId === undefined ? {} : { partyId: input.nativePartyId })
  };
}

function journalIdentities(
  context: ServiceContext,
  journal: NormalizedJournalEntry
): Pick<PostJournalEntryResult, "transactionId" | "transactionLineIds" | "postingIds" | "importBatchId"> & {
  readonly sourcePostingIds: readonly string[];
} {
  const transactionId = scopedRecordId(
    context,
    "transaction",
    `${journal.sourceTransactionType}:${journal.idempotencyKey}`
  );
  const sourcePostingIds = journal.lines.map((line) =>
    scopedRecordId(
      context,
      "journal_line",
      `${journal.sourceTransactionType}:${journal.idempotencyKey}:${line.lineId}`
    )
  );

  return {
    transactionId,
    transactionLineIds: journal.lines.map((line) =>
      scopedRecordId(
        context,
        "transaction_line",
        `${journal.sourceTransactionType}:${journal.idempotencyKey}:${line.lineId}`
      )
    ),
    sourcePostingIds,
    postingIds: sourcePostingIds.map((sourcePostingId) => scopedRecordId(context, "posting", sourcePostingId)),
    importBatchId: scopedRecordId(context, "import_batch", `${journal.sourceTransactionType}:${journal.idempotencyKey}`)
  };
}

function journalFacts(
  context: ServiceContext,
  journal: NormalizedJournalEntry,
  identities: ReturnType<typeof journalIdentities>,
  postedAt: IsoDateTime
): {
  readonly importBatch: ImportBatch;
  readonly transaction: AccountingTransaction;
  readonly transactionLines: readonly TransactionLine[];
  readonly postings: readonly LedgerPosting[];
} {
  const transactionRef: SafeSourcePayloadRef = {
    sourceObjectType: journal.sourceTransactionType,
    sourceObjectId: journal.idempotencyKey,
    sourceUpdatedAt: postedAt,
    checksum: journal.checksum,
    preview: {
      accountingBasis: journal.accountingBasis,
      currencyCode: journal.currencyCode,
      lineCount: journal.lines.length,
      transactionDate: journal.date
    }
  };
  assertNoCredentialKeys(transactionRef);

  const transaction: AccountingTransaction = {
    tenantId: context.tenantId,
    sourceId: context.sourceId,
    transactionId: identities.transactionId,
    sourceTransactionId: journal.idempotencyKey,
    sourceTransactionType: journal.sourceTransactionType,
    ...(journal.transactionNumber === undefined ? {} : { transactionNumber: journal.transactionNumber }),
    transactionDate: journal.date,
    postedAt,
    updatedAt: postedAt,
    ...(journal.partyId === undefined ? {} : { partyId: journal.partyId }),
    currencyCode: journal.currencyCode,
    status: "posted",
    ...(journal.memo === undefined ? {} : { memo: journal.memo }),
    sourcePayloadRef: transactionRef
  };

  const transactionLines = journal.lines.map((line, index): TransactionLine => ({
    tenantId: context.tenantId,
    sourceId: context.sourceId,
    transactionLineId: requiredIndex(identities.transactionLineIds, index, "transaction line id"),
    transactionId: identities.transactionId,
    lineNumber: line.lineNumber,
    accountId: line.accountId,
    ...(line.partyId === undefined ? {} : { partyId: line.partyId }),
    ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
    amount: formatMoney(line.debitMinor - line.creditMinor),
    ...(line.description === undefined ? {} : { description: line.description }),
    dimensionRefs: line.dimensionRefs
  }));

  const postings = journal.lines.map((line, index): LedgerPosting => {
    const sourcePostingId = requiredIndex(identities.sourcePostingIds, index, "source posting id");
    return {
      tenantId: context.tenantId,
      sourceId: context.sourceId,
      postingId: requiredIndex(identities.postingIds, index, "posting id"),
      sourcePostingId,
      transactionId: identities.transactionId,
      transactionLineId: requiredIndex(identities.transactionLineIds, index, "transaction line id"),
      accountId: line.accountId,
      ...(line.partyId === undefined ? {} : { partyId: line.partyId }),
      ...(line.itemId === undefined ? {} : { itemId: line.itemId }),
      postingDate: journal.date,
      accountingBasis: journal.accountingBasis,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
      netAmount: formatMoney(line.debitMinor - line.creditMinor),
      currencyCode: journal.currencyCode,
      dimensionHash: createDimensionHash(line.dimensionRefs),
      dimensionRefs: line.dimensionRefs,
      sourcePayloadRef: {
        sourceObjectType: `${journal.sourceTransactionType}Line`,
        sourceObjectId: sourcePostingId,
        sourceUpdatedAt: postedAt,
        checksum: journal.checksum,
        preview: {
          journalEntryId: journal.idempotencyKey,
          lineId: line.lineId,
          lineNumber: line.lineNumber
        }
      },
      importBatchId: identities.importBatchId
    };
  });

  return {
    importBatch: {
      tenantId: context.tenantId,
      sourceId: context.sourceId,
      importBatchId: identities.importBatchId,
      mode: "delta",
      status: "completed",
      startedAt: postedAt,
      completedAt: postedAt,
      sourceObjectCounts: {
        accounts: 0,
        postings: postings.length,
        transactions: 1
      }
    },
    transaction,
    transactionLines,
    postings
  };
}

async function acquireTransactionLock(client: PostgresQueryClient, lockKey: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
}

async function appendServiceOutboxEvent(
  client: PostgresQueryClient,
  context: ServiceContext,
  input: {
    readonly eventType: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly idempotencyKey: string;
    readonly payload: import("./canonical-model.js").JsonValue;
  }
): Promise<string> {
  return appendFinancialOutboxEvent(client, {
    tenantId: context.tenantId,
    companyId: context.companyId,
    ...(context.bookId === undefined ? {} : { bookId: context.bookId }),
    sourceId: context.sourceId,
    ...input,
    availableAt: context.now()
  });
}

async function assertCompanySourceScope(client: PostgresQueryClient, context: ServiceContext): Promise<void> {
  const result = await client.query<{ readonly company_source_id: string }>(
    `select "company_source_id"
from "erp_financials"."company_sources"
where "tenant_id" = $1 and "company_id" = $2 and "source_id" = $3
for key share`,
    [context.tenantId, context.companyId, context.sourceId]
  );
  if (result.rows[0] === undefined) {
    throw new ErpFinancialsValidationError(
      `Company ${context.companyId} is not bound to source ${context.sourceId} for tenant ${context.tenantId}`,
      "scope_mismatch",
      { companyId: context.companyId, sourceId: context.sourceId }
    );
  }
}

async function loadExistingJournal(
  client: PostgresQueryClient,
  context: ServiceContext,
  idempotencyKey: string,
  sourceTransactionType: string
): Promise<{ readonly transactionId: string; readonly status: string; readonly sourcePayloadRef: unknown } | undefined> {
  const result = await client.query<ExistingJournalRow>(
    `select "transaction_id", "status", "source_payload_ref"
from "erp_financials"."transactions"
where "tenant_id" = $1
  and "source_id" = $2
  and "source_transaction_type" = $4
  and "source_transaction_id" = $3
for update`,
    [context.tenantId, context.sourceId, idempotencyKey, sourceTransactionType]
  );
  const row = result.rows[0];
  if (row === undefined) {
    return undefined;
  }

  if (typeof row.transaction_id !== "string" || typeof row.status !== "string") {
    throw new Error("Stored journal entry has invalid transaction identity or status");
  }

  return {
    transactionId: row.transaction_id,
    status: row.status,
    sourcePayloadRef: row.source_payload_ref
  };
}

function sourceRefChecksum(value: unknown): string | undefined {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (typeof parsed !== "object" || parsed === null || !("checksum" in parsed)) {
    return undefined;
  }
  return typeof parsed.checksum === "string" ? parsed.checksum : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function alreadyPostedResult(
  identities: ReturnType<typeof journalIdentities>,
  lifecycleEventId: string
): PostJournalEntryResult {
  return {
    status: "already_posted",
    transactionId: identities.transactionId,
    transactionLineIds: identities.transactionLineIds,
    postingIds: identities.postingIds,
    importBatchId: identities.importBatchId,
    lifecycleEventId,
    snapshotsMarkedStale: 0,
    writeCounts: {
      importBatches: 0,
      transactions: 0,
      transactionLines: 0,
      postings: 0
    }
  };
}

async function appendJournalPostedLifecycleEvent(
  client: PostgresQueryClient,
  context: ServiceContext,
  operation: FinancialOperationContext,
  journal: NormalizedJournalEntry,
  identities: ReturnType<typeof journalIdentities>
) {
  return appendFinancialLifecycleEvent(client, {
    tenantId: context.tenantId,
    companyId: context.companyId,
    sourceId: context.sourceId,
    aggregateType: journal.lifecycleAggregateType,
    aggregateId: identities.transactionId,
    eventType: journal.lifecycleEventType,
    idempotencyKey: `${journal.lifecycleAggregateType}:${journal.sourceTransactionType}:${journal.idempotencyKey}:posted`,
    operation,
    recordedAt: context.now(),
    payload: {
      accountingBasis: journal.accountingBasis,
      adjustment: journal.adjustment,
      currencyCode: journal.currencyCode,
      importBatchId: identities.importBatchId,
      postingIds: identities.postingIds,
      transactionDate: journal.date,
      transactionId: identities.transactionId
    }
  });
}

function assertJournalAccounts(accounts: readonly Account[], requestedAccountIds: readonly AccountId[]): void {
  const accountsById = new Map(accounts.map((account) => [account.accountId, account]));
  const missing = requestedAccountIds.filter((accountId) => !accountsById.has(accountId));
  if (missing.length > 0) {
    throw new ErpFinancialsValidationError(
      `Journal entry references missing accounts: ${missing.join(", ")}`,
      "missing_account",
      { accountIds: missing.join(",") }
    );
  }

  const inactive = requestedAccountIds.filter((accountId) => accountsById.get(accountId)?.active === false);
  if (inactive.length > 0) {
    throw new ErpFinancialsValidationError(`Journal entry references inactive accounts: ${inactive.join(", ")}`);
  }
}

function resolveAccountId(
  context: Pick<ServiceContext, "tenantId" | "sourceId">,
  reference: ErpFinancialsAccountReference
): AccountId {
  const accountKey = (reference as { readonly accountKey?: unknown }).accountKey;
  const accountId = (reference as { readonly accountId?: unknown }).accountId;

  if ((accountKey === undefined) === (accountId === undefined)) {
    throw new ErpFinancialsValidationError("Account reference must have exactly one of accountKey or accountId");
  }
  if (accountKey !== undefined) {
    if (typeof accountKey !== "string") {
      throw new ErpFinancialsValidationError("accountKey must be a string");
    }
    assertNonEmpty(accountKey, "accountKey");
    return scopedRecordId(context, "account", accountKey);
  }
  if (typeof accountId !== "string") {
    throw new ErpFinancialsValidationError("accountId must be a string");
  }
  assertNonEmpty(accountId, "accountId");
  return accountId;
}

function accountReferenceKey(reference: ErpFinancialsAccountReference): string {
  const accountKey = (reference as { readonly accountKey?: unknown }).accountKey;
  const accountId = (reference as { readonly accountId?: unknown }).accountId;

  if (typeof accountKey === "string") {
    return accountKey;
  }
  if (typeof accountId === "string") {
    return accountId;
  }
  throw new ErpFinancialsValidationError("Account reference must have exactly one of accountKey or accountId");
}

function parsePositiveMoney(value: unknown, field: string): bigint {
  if (typeof value !== "string") {
    throw new ErpFinancialsValidationError(`${field} must be a decimal string`);
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[1] === undefined) {
    throw new ErpFinancialsValidationError(`${field} must be a nonnegative decimal with at most two fractional digits`);
  }
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor === 0n) {
    throw new ErpFinancialsValidationError(`${field} must be greater than zero`);
  }
  return minor;
}

function formatMoney(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${(absolute / 100n).toString()}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function scopedRecordId(context: Pick<ServiceContext, "tenantId" | "sourceId">, kind: string, key: string): string {
  const digest = createHash("sha256")
    .update([context.tenantId, context.sourceId, kind, key].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
  return `${kind}_${digest}`;
}

function assertIsoDate(value: string, field: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new ErpFinancialsValidationError(`${field} must be an ISO date in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ErpFinancialsValidationError(`${field} must be a valid ISO date`);
  }
}

function assertAccountingBasis(value: string): void {
  if (!ACCOUNTING_BASES.has(value)) {
    throw new ErpFinancialsValidationError(`Unsupported accountingBasis ${value}`);
  }
}

function assertCurrencyAllowed(context: ServiceContext, currencyCode: string): void {
  assertNonEmpty(currencyCode, "currencyCode");
  if (currencyCode !== context.currencyCode) {
    throw new ErpFinancialsValidationError(
      `Currency ${currencyCode} is not supported by single-currency financial scope ${context.currencyCode}`,
      "currency_not_supported",
      { baseCurrencyCode: context.currencyCode, currencyCode }
    );
  }
}

function assertIsoDateTime(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new ErpFinancialsValidationError(`${field} must be a valid ISO date-time`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ErpFinancialsValidationError(`${field} must not be empty`);
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function requiredIndex<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing ${label} at index ${String(index)}`);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry === undefined ? null : entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  throw new ErpFinancialsValidationError("Journal entry contains a value that cannot be checksummed");
}
