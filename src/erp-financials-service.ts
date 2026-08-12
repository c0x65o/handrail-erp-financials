import { createHash } from "node:crypto";

import { assertValidAccountHierarchy } from "./account-hierarchy.js";
import { assertNoCredentialKeys, createDimensionHash } from "./canonical-model.js";
import { ACCOUNT_HIERARCHY_CHANGED_STALE_REASON } from "./rollup-jobs.js";
import { createPostgresStorageAdapter } from "./postgres-storage.js";

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
  LedgerPosting,
  SafeSourcePayloadRef,
  TransactionLine
} from "./canonical-model.js";
import type { PostgresQueryClient } from "./postgres-storage.js";

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
  readonly currencyCode: IsoCurrencyCode;
  readonly accountingBasis?: AccountingBasis;
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
  readonly parent: ErpFinancialsAccountDefinition;
  readonly children?: readonly ErpFinancialsAccountTreeNode[];
  readonly staleReason?: string;
};

export type UpsertAccountTreeResult = {
  readonly accounts: readonly Account[];
  readonly accountsWritten: number;
  readonly snapshotsMarkedStale: number;
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
  readonly idempotencyKey: string;
  readonly date: IsoDate;
  readonly transactionNumber?: string;
  readonly memo?: string;
  readonly postedAt?: IsoDateTime;
  readonly currencyCode?: IsoCurrencyCode;
  readonly accountingBasis?: AccountingBasis;
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
};

export type ErpFinancials = {
  readonly accounts: {
    upsertTree(input: UpsertAccountTreeInput): Promise<UpsertAccountTreeResult>;
  };
  readonly journalEntries: {
    post(input: PostJournalEntryInput): Promise<PostJournalEntryResult>;
  };
};

export class ErpFinancialsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErpFinancialsValidationError";
    Object.setPrototypeOf(this, ErpFinancialsValidationError.prototype);
  }
}

export class ErpFinancialsIdempotencyConflictError extends Error {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`Journal entry idempotency key ${idempotencyKey} is already associated with different content or status`);
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
  readonly currencyCode: IsoCurrencyCode;
  readonly accountingBasis: AccountingBasis;
  readonly now: () => IsoDateTime;
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
      }
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

    return {
      accounts,
      accountsWritten,
      snapshotsMarkedStale
    };
  });
}

async function postJournalEntry(
  context: ServiceContext,
  input: PostJournalEntryInput
): Promise<PostJournalEntryResult> {
  const journal = normalizeJournalEntry(context, input);
  const identities = journalIdentities(context, journal);

  return context.database.transaction(async (client) => {
    await acquireTransactionLock(
      client,
      `journal-entry:${context.tenantId}:${context.sourceId}:${journal.idempotencyKey}`
    );
    await assertCompanySourceScope(client, context);

    const existing = await loadExistingJournal(client, context, journal.idempotencyKey);
    if (existing !== undefined) {
      if (
        existing.transactionId === identities.transactionId &&
        existing.status === "posted" &&
        sourceRefChecksum(existing.sourcePayloadRef) === journal.checksum
      ) {
        return alreadyPostedResult(identities);
      }
      throw new ErpFinancialsIdempotencyConflictError(journal.idempotencyKey);
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

    return {
      status: "posted",
      transactionId: identities.transactionId,
      transactionLineIds: identities.transactionLineIds,
      postingIds: identities.postingIds,
      importBatchId: identities.importBatchId,
      snapshotsMarkedStale,
      writeCounts
    };
  });
}

function serviceContext(input: CreateErpFinancialsInput): ServiceContext {
  assertNonEmpty(input.tenantId, "tenantId");
  assertNonEmpty(input.companyId, "companyId");
  assertNonEmpty(input.sourceId, "sourceId");
  assertNonEmpty(input.currencyCode, "currencyCode");
  const accountingBasis = input.accountingBasis ?? "accrual";
  assertAccountingBasis(accountingBasis);

  return {
    database: isTransactionRunner(input.database)
      ? input.database
      : createPostgresTransactionRunner(input.database),
    tenantId: input.tenantId,
    companyId: input.companyId,
    sourceId: input.sourceId,
    currencyCode: input.currencyCode,
    accountingBasis,
    now: input.now ?? (() => new Date().toISOString())
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

function normalizeJournalEntry(context: ServiceContext, input: PostJournalEntryInput): NormalizedJournalEntry {
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
      `Journal entry is unbalanced: debits ${formatMoney(debitMinor)}, credits ${formatMoney(creditMinor)}`
    );
  }

  const currencyCode = input.currencyCode ?? context.currencyCode;
  const accountingBasis = input.accountingBasis ?? context.accountingBasis;
  assertNonEmpty(currencyCode, "currencyCode");
  assertAccountingBasis(accountingBasis);
  if (input.postedAt !== undefined) {
    assertIsoDateTime(input.postedAt, "postedAt");
  }

  const checksum = createHash("sha256")
    .update(
      stableJson({
        accountingBasis,
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
    staleReason: input.staleReason ?? JOURNAL_ENTRY_POSTED_STALE_REASON
  };
}

function journalIdentities(
  context: ServiceContext,
  journal: NormalizedJournalEntry
): Pick<PostJournalEntryResult, "transactionId" | "transactionLineIds" | "postingIds" | "importBatchId"> & {
  readonly sourcePostingIds: readonly string[];
} {
  const transactionId = scopedRecordId(context, "transaction", journal.idempotencyKey);
  const sourcePostingIds = journal.lines.map((line) =>
    scopedRecordId(context, "journal_line", `${journal.idempotencyKey}:${line.lineId}`)
  );

  return {
    transactionId,
    transactionLineIds: journal.lines.map((line) =>
      scopedRecordId(context, "transaction_line", `${journal.idempotencyKey}:${line.lineId}`)
    ),
    sourcePostingIds,
    postingIds: sourcePostingIds.map((sourcePostingId) => scopedRecordId(context, "posting", sourcePostingId)),
    importBatchId: scopedRecordId(context, "import_batch", journal.idempotencyKey)
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
    sourceObjectType: "NativeJournalEntry",
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
    sourceTransactionType: "JournalEntry",
    ...(journal.transactionNumber === undefined ? {} : { transactionNumber: journal.transactionNumber }),
    transactionDate: journal.date,
    postedAt,
    updatedAt: postedAt,
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
        sourceObjectType: "NativeJournalEntryLine",
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
      `Company ${context.companyId} is not bound to source ${context.sourceId} for tenant ${context.tenantId}`
    );
  }
}

async function loadExistingJournal(
  client: PostgresQueryClient,
  context: ServiceContext,
  idempotencyKey: string
): Promise<{ readonly transactionId: string; readonly status: string; readonly sourcePayloadRef: unknown } | undefined> {
  const result = await client.query<ExistingJournalRow>(
    `select "transaction_id", "status", "source_payload_ref"
from "erp_financials"."transactions"
where "tenant_id" = $1
  and "source_id" = $2
  and "source_transaction_type" = 'JournalEntry'
  and "source_transaction_id" = $3
for update`,
    [context.tenantId, context.sourceId, idempotencyKey]
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
  identities: ReturnType<typeof journalIdentities>
): PostJournalEntryResult {
  return {
    status: "already_posted",
    transactionId: identities.transactionId,
    transactionLineIds: identities.transactionLineIds,
    postingIds: identities.postingIds,
    importBatchId: identities.importBatchId,
    snapshotsMarkedStale: 0,
    writeCounts: {
      importBatches: 0,
      transactions: 0,
      transactionLines: 0,
      postings: 0
    }
  };
}

function assertJournalAccounts(accounts: readonly Account[], requestedAccountIds: readonly AccountId[]): void {
  const accountsById = new Map(accounts.map((account) => [account.accountId, account]));
  const missing = requestedAccountIds.filter((accountId) => !accountsById.has(accountId));
  if (missing.length > 0) {
    throw new ErpFinancialsValidationError(`Journal entry references missing accounts: ${missing.join(", ")}`);
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
