import { createHash } from "node:crypto";

import type {
  Account,
  AccountClassification,
  AccountingBasis,
  AccountingCompany,
  AccountingDimension,
  AccountingSource,
  AccountingSourceSystem,
  AccountingTransaction,
  DecimalString,
  DimensionRef,
  ImportBatch,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  Item,
  JsonValue,
  LedgerPosting,
  Party,
  ProviderEnvironment,
  SafeSourcePayloadRef,
  SourceId,
  SyncCheckpoint,
  TenantId,
  TransactionLine
} from "./canonical-model.js";
import { assertLedgerPostingAmounts, assertSafeSourcePayloadRef, createDimensionHash } from "./canonical-model.js";

export type CanonicalAccountingFactSet = {
  readonly company: AccountingCompany;
  readonly source: AccountingSource;
  readonly importBatch: ImportBatch;
  readonly checkpoint: SyncCheckpoint;
  readonly accounts: readonly Account[];
  readonly parties: readonly Party[];
  readonly items: readonly Item[];
  readonly dimensions: readonly AccountingDimension[];
  readonly transactions: readonly AccountingTransaction[];
  readonly transactionLines: readonly TransactionLine[];
  readonly postings: readonly LedgerPosting[];
};

export type SourceAdapterContext = {
  readonly tenantId: TenantId;
  readonly companyId: string;
  readonly sourceId: SourceId;
  readonly sourceSystem: AccountingSourceSystem;
  readonly providerEnvironment: ProviderEnvironment;
  readonly sourceCompanyRef: string;
  readonly connectionRef: string;
  readonly importBatchId: string;
  readonly checkpointId: string;
  readonly accountingBasis: AccountingBasis;
  readonly defaultCurrencyCode: IsoCurrencyCode;
  readonly importedAt: IsoDateTime;
  readonly freshThrough?: IsoDateTime;
  readonly latestSourceUpdatedAt?: IsoDateTime;
};

export type SourceAdapter<Input> = {
  readonly sourceSystem: AccountingSourceSystem;
  map(input: Input): CanonicalAccountingFactSet;
};

export type NativeLedgerAccount = {
  readonly sourceAccountId: string;
  readonly name: string;
  readonly classification: AccountClassification;
  readonly accountNumber?: string;
  readonly type?: string;
  readonly subtype?: string;
  readonly active?: boolean;
  readonly currencyCode?: IsoCurrencyCode;
};

export type NativeLedgerLine = {
  readonly sourceLineId?: string;
  readonly lineNumber: number;
  readonly accountSourceId: string;
  readonly debitAmount?: DecimalString;
  readonly creditAmount?: DecimalString;
  readonly amount?: DecimalString;
  readonly partySourceId?: string;
  readonly itemSourceId?: string;
  readonly quantity?: DecimalString;
  readonly unitAmount?: DecimalString;
  readonly description?: string;
  readonly dimensionRefs?: readonly DimensionRef[];
  readonly sourcePayloadRef?: SafeSourcePayloadRef;
};

export type NativeLedgerTransaction = {
  readonly sourceTransactionId: string;
  readonly sourceTransactionType: string;
  readonly transactionDate: IsoDate;
  readonly transactionNumber?: string;
  readonly postedAt?: IsoDateTime;
  readonly updatedAt?: IsoDateTime;
  readonly partySourceId?: string;
  readonly currencyCode?: IsoCurrencyCode;
  readonly exchangeRate?: DecimalString;
  readonly memo?: string;
  readonly sourcePayloadRef?: SafeSourcePayloadRef;
  readonly lines: readonly NativeLedgerLine[];
};

export type NativeLedgerAdapterInput = {
  readonly context: SourceAdapterContext;
  readonly company: {
    readonly legalName: string;
    readonly displayName: string;
    readonly fiscalYearStartMonth?: number;
  };
  readonly accounts: readonly NativeLedgerAccount[];
  readonly transactions: readonly NativeLedgerTransaction[];
  readonly parties?: readonly Party[];
  readonly items?: readonly Item[];
  readonly dimensions?: readonly AccountingDimension[];
};

export type HandrailQuickBooksRuntimeConfigRef = {
  readonly serviceEnvironment: "staging" | "production";
  readonly providerMode: "sandbox" | "production";
  readonly tenantId: TenantId;
};

export type QuickBooksAdapterContext = Omit<
  SourceAdapterContext,
  "sourceSystem" | "providerEnvironment" | "sourceCompanyRef" | "connectionRef"
> & {
  readonly realmId: string;
  readonly providerEnvironment: Extract<ProviderEnvironment, "sandbox" | "production">;
  readonly runtimeConfig?: HandrailQuickBooksRuntimeConfigRef;
};

export type QuickBooksSdkRef = {
  readonly value?: string;
  readonly name?: string;
};

export type QuickBooksSdkAccount = {
  readonly Id: string;
  readonly Name: string;
  readonly AcctNum?: string;
  readonly AccountType: string;
  readonly AccountSubType?: string;
  readonly Active?: boolean;
  readonly CurrencyRef?: QuickBooksSdkRef;
};

export type QuickBooksSdkJournalEntryLineDetail = {
  readonly PostingType: "Debit" | "Credit";
  readonly AccountRef: QuickBooksSdkRef;
  readonly Entity?: { readonly EntityRef?: QuickBooksSdkRef };
  readonly ClassRef?: QuickBooksSdkRef;
  readonly DepartmentRef?: QuickBooksSdkRef;
};

export type QuickBooksSdkJournalEntryLine = {
  readonly Id?: string;
  readonly LineNum?: number;
  readonly Description?: string;
  readonly Amount: number | DecimalString;
  readonly DetailType?: string;
  readonly JournalEntryLineDetail: QuickBooksSdkJournalEntryLineDetail;
};

export type QuickBooksSdkJournalEntry = {
  readonly Id: string;
  readonly SyncToken?: string;
  readonly TxnDate: IsoDate;
  readonly DocNumber?: string;
  readonly PrivateNote?: string;
  readonly CurrencyRef?: QuickBooksSdkRef;
  readonly MetaData?: {
    readonly LastUpdatedTime?: IsoDateTime;
  };
  readonly Line: readonly QuickBooksSdkJournalEntryLine[];
};

export type QuickBooksJournalEntryAdapterInput = {
  readonly context: QuickBooksAdapterContext;
  readonly companyInfo: {
    readonly CompanyName?: string;
    readonly LegalName?: string;
    readonly FiscalYearStartMonth?: number;
  };
  readonly accounts: readonly QuickBooksSdkAccount[];
  readonly journalEntries: readonly QuickBooksSdkJournalEntry[];
};

type NormalizedLedgerInput = {
  readonly context: SourceAdapterContext;
  readonly company: {
    readonly legalName: string;
    readonly displayName: string;
    readonly fiscalYearStartMonth?: number;
  };
  readonly accounts: readonly NativeLedgerAccount[];
  readonly transactions: readonly NativeLedgerTransaction[];
  readonly parties?: readonly Party[];
  readonly items?: readonly Item[];
  readonly dimensions?: readonly AccountingDimension[];
};

export const nativeLedgerSourceAdapter: SourceAdapter<NativeLedgerAdapterInput> = {
  sourceSystem: "native_erp",
  map: mapNativeLedgerToCanonicalFacts
};

export const quickBooksJournalEntrySourceAdapter: SourceAdapter<QuickBooksJournalEntryAdapterInput> = {
  sourceSystem: "quickbooks",
  map: mapQuickBooksJournalEntriesToCanonicalFacts
};

export function mapNativeLedgerToCanonicalFacts(input: NativeLedgerAdapterInput): CanonicalAccountingFactSet {
  return mapNormalizedLedgerToCanonicalFacts(input);
}

export function mapQuickBooksJournalEntriesToCanonicalFacts(input: QuickBooksJournalEntryAdapterInput): CanonicalAccountingFactSet {
  const context: SourceAdapterContext = {
    ...input.context,
    sourceSystem: "quickbooks",
    sourceCompanyRef: input.context.realmId,
    connectionRef: quickBooksConnectionRef(input.context)
  };
  const transactions = input.journalEntries.map((journalEntry): NativeLedgerTransaction => {
    const sourceUpdatedAt = journalEntry.MetaData?.LastUpdatedTime ?? context.latestSourceUpdatedAt;
    return {
      sourceTransactionId: journalEntry.Id,
      sourceTransactionType: "JournalEntry",
      transactionDate: journalEntry.TxnDate,
      ...(journalEntry.DocNumber === undefined ? {} : { transactionNumber: journalEntry.DocNumber }),
      ...(sourceUpdatedAt === undefined ? {} : { updatedAt: sourceUpdatedAt }),
      currencyCode: journalEntry.CurrencyRef?.value ?? context.defaultCurrencyCode,
      ...(journalEntry.PrivateNote === undefined ? {} : { memo: journalEntry.PrivateNote }),
      sourcePayloadRef: quickBooksPayloadRef({
        context,
        sourceObjectType: "JournalEntry",
        sourceObjectId: journalEntry.Id,
        ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
        preview: {
          realmId: input.context.realmId,
          docNumber: journalEntry.DocNumber ?? null,
          syncToken: journalEntry.SyncToken ?? null,
          txnDate: journalEntry.TxnDate
        }
      }),
      lines: journalEntry.Line.map((line, index): NativeLedgerLine => {
        const accountSourceId = requiredRefValue(line.JournalEntryLineDetail.AccountRef, "JournalEntryLine.AccountRef");
        const lineNumber = line.LineNum ?? index + 1;
        const lineSourceId = line.Id ?? String(lineNumber);
        const amount = decimalFromNumber(line.Amount);
        const dimensionRefs = quickBooksDimensionRefs(line.JournalEntryLineDetail);
        return {
          sourceLineId: lineSourceId,
          lineNumber,
          accountSourceId,
          ...(line.JournalEntryLineDetail.PostingType === "Debit" ? { debitAmount: amount } : { creditAmount: amount }),
          ...(line.Description === undefined ? {} : { description: line.Description }),
          ...(dimensionRefs.length === 0 ? {} : { dimensionRefs }),
          sourcePayloadRef: quickBooksPayloadRef({
            context,
            sourceObjectType: "JournalEntryLine",
            sourceObjectId: `${journalEntry.Id}:${lineSourceId}`,
            ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
            preview: {
              realmId: input.context.realmId,
              journalEntryId: journalEntry.Id,
              lineId: lineSourceId,
              postingType: line.JournalEntryLineDetail.PostingType
            }
          })
        };
      })
    };
  });

  return mapNormalizedLedgerToCanonicalFacts({
    context,
    company: {
      legalName: input.companyInfo.LegalName ?? input.companyInfo.CompanyName ?? input.context.realmId,
      displayName: input.companyInfo.CompanyName ?? input.companyInfo.LegalName ?? input.context.realmId,
      ...(input.companyInfo.FiscalYearStartMonth === undefined ? {} : { fiscalYearStartMonth: input.companyInfo.FiscalYearStartMonth })
    },
    accounts: input.accounts.map(quickBooksAccountToNativeAccount),
    transactions
  });
}

function mapNormalizedLedgerToCanonicalFacts(input: NormalizedLedgerInput): CanonicalAccountingFactSet {
  const accounts = input.accounts.map((account): Account => accountFromNative(input.context, account));
  const accountIdBySourceId = new Map(accounts.map((account) => [account.sourceAccountId, account.accountId]));
  const transactions = input.transactions.map((transaction): AccountingTransaction => {
    const sourcePayloadRef = transaction.sourcePayloadRef ?? defaultPayloadRef(transaction.sourceTransactionType, transaction.sourceTransactionId, transaction.updatedAt);
    assertSafeSourcePayloadRef(sourcePayloadRef);
    return {
      tenantId: input.context.tenantId,
      sourceId: input.context.sourceId,
      transactionId: canonicalRecordId(input.context, "transaction", transaction.sourceTransactionId),
      sourceTransactionId: transaction.sourceTransactionId,
      sourceTransactionType: transaction.sourceTransactionType,
      ...(transaction.transactionNumber === undefined ? {} : { transactionNumber: transaction.transactionNumber }),
      transactionDate: transaction.transactionDate,
      ...(transaction.postedAt === undefined ? {} : { postedAt: transaction.postedAt }),
      ...(transaction.updatedAt === undefined ? {} : { updatedAt: transaction.updatedAt }),
      ...(transaction.partySourceId === undefined
        ? {}
        : { partyId: canonicalRecordId(input.context, "party", transaction.partySourceId) }),
      currencyCode: transaction.currencyCode ?? input.context.defaultCurrencyCode,
      ...(transaction.exchangeRate === undefined ? {} : { exchangeRate: transaction.exchangeRate }),
      status: "posted",
      ...(transaction.memo === undefined ? {} : { memo: transaction.memo }),
      sourcePayloadRef
    };
  });
  const transactionIdBySourceId = new Map(transactions.map((transaction) => [transaction.sourceTransactionId, transaction.transactionId]));
  const transactionLines = input.transactions.flatMap((transaction): TransactionLine[] =>
    transaction.lines.map((line): TransactionLine => {
      const transactionId = requiredMapValue(transactionIdBySourceId, transaction.sourceTransactionId, "transaction");
      const amounts = lineAmounts(line);
      const transactionLineId = canonicalRecordId(
        input.context,
        "transaction_line",
        `${transaction.sourceTransactionId}:${line.sourceLineId ?? String(line.lineNumber)}`
      );
      return {
        tenantId: input.context.tenantId,
        transactionLineId,
        transactionId,
        lineNumber: line.lineNumber,
        accountId: requiredMapValue(accountIdBySourceId, line.accountSourceId, "account"),
        ...(line.partySourceId === undefined ? {} : { partyId: canonicalRecordId(input.context, "party", line.partySourceId) }),
        ...(line.itemSourceId === undefined ? {} : { itemId: canonicalRecordId(input.context, "item", line.itemSourceId) }),
        amount: formatMinor(amounts.debitMinor - amounts.creditMinor),
        ...(line.quantity === undefined ? {} : { quantity: line.quantity }),
        ...(line.unitAmount === undefined ? {} : { unitAmount: line.unitAmount }),
        ...(line.description === undefined ? {} : { description: line.description }),
        dimensionRefs: line.dimensionRefs ?? []
      };
    })
  );
  const lineIdBySourceKey = new Map(
    input.transactions.flatMap((transaction) =>
      transaction.lines.map((line) => [
        `${transaction.sourceTransactionId}:${line.sourceLineId ?? String(line.lineNumber)}`,
        canonicalRecordId(input.context, "transaction_line", `${transaction.sourceTransactionId}:${line.sourceLineId ?? String(line.lineNumber)}`)
      ])
    )
  );
  const postings = input.transactions.flatMap((transaction): LedgerPosting[] =>
    transaction.lines.map((line): LedgerPosting => {
      const sourceLineId = line.sourceLineId ?? String(line.lineNumber);
      const sourcePostingId = `${transaction.sourceTransactionId}:${sourceLineId}`;
      const amounts = lineAmounts(line);
      const sourcePayloadRef = line.sourcePayloadRef ?? defaultPayloadRef(`${transaction.sourceTransactionType}Line`, sourcePostingId, transaction.updatedAt);
      assertSafeSourcePayloadRef(sourcePayloadRef);
      const posting: LedgerPosting = {
        tenantId: input.context.tenantId,
        sourceId: input.context.sourceId,
        postingId: canonicalRecordId(input.context, "posting", sourcePostingId),
        sourcePostingId,
        transactionId: requiredMapValue(transactionIdBySourceId, transaction.sourceTransactionId, "transaction"),
        transactionLineId: requiredMapValue(lineIdBySourceKey, sourcePostingId, "transaction line"),
        accountId: requiredMapValue(accountIdBySourceId, line.accountSourceId, "account"),
        ...(line.partySourceId === undefined ? {} : { partyId: canonicalRecordId(input.context, "party", line.partySourceId) }),
        ...(line.itemSourceId === undefined ? {} : { itemId: canonicalRecordId(input.context, "item", line.itemSourceId) }),
        postingDate: transaction.transactionDate,
        accountingBasis: input.context.accountingBasis,
        debitAmount: formatMinor(amounts.debitMinor),
        creditAmount: formatMinor(amounts.creditMinor),
        netAmount: formatMinor(amounts.debitMinor - amounts.creditMinor),
        currencyCode: transaction.currencyCode ?? input.context.defaultCurrencyCode,
        dimensionHash: createDimensionHash(line.dimensionRefs ?? []),
        dimensionRefs: line.dimensionRefs ?? [],
        sourcePayloadRef,
        importBatchId: input.context.importBatchId,
        checkpointId: input.context.checkpointId
      };
      assertLedgerPostingAmounts(posting);
      return posting;
    })
  );

  return {
    company: {
      tenantId: input.context.tenantId,
      companyId: input.context.companyId,
      legalName: input.company.legalName,
      displayName: input.company.displayName,
      baseCurrencyCode: input.context.defaultCurrencyCode,
      fiscalYearStartMonth: input.company.fiscalYearStartMonth ?? 1,
      providerEnvironment: input.context.providerEnvironment,
      sourceSystem: input.context.sourceSystem,
      sourceCompanyRef: input.context.sourceCompanyRef
    },
    source: {
      tenantId: input.context.tenantId,
      sourceId: input.context.sourceId,
      sourceSystem: input.context.sourceSystem,
      providerEnvironment: input.context.providerEnvironment,
      connectionRef: input.context.connectionRef,
      importBatchId: input.context.importBatchId,
      checkpointId: input.context.checkpointId,
      latestSyncedAt: input.context.importedAt,
      status: "active"
    },
    importBatch: {
      tenantId: input.context.tenantId,
      sourceId: input.context.sourceId,
      importBatchId: input.context.importBatchId,
      mode: "delta",
      status: "completed",
      startedAt: input.context.importedAt,
      completedAt: input.context.importedAt,
      sourceObjectCounts: sourceObjectCounts(input.accounts.length, input.transactions.length, postings.length)
    },
    checkpoint: {
      tenantId: input.context.tenantId,
      sourceId: input.context.sourceId,
      checkpointId: input.context.checkpointId,
      sourceObject: "ledger_postings",
      cursorKind: "updated_since",
      cursorValue: input.context.latestSourceUpdatedAt ?? input.context.importedAt,
      freshThrough: input.context.freshThrough ?? input.context.importedAt,
      latestSourceUpdatedAt: input.context.latestSourceUpdatedAt ?? input.context.importedAt,
      status: "current"
    },
    accounts,
    parties: input.parties ?? [],
    items: input.items ?? [],
    dimensions: input.dimensions ?? [],
    transactions,
    transactionLines,
    postings
  };
}

function accountFromNative(context: SourceAdapterContext, account: NativeLedgerAccount): Account {
  return {
    tenantId: context.tenantId,
    sourceId: context.sourceId,
    accountId: canonicalRecordId(context, "account", account.sourceAccountId),
    sourceAccountId: account.sourceAccountId,
    ...(account.accountNumber === undefined ? {} : { accountNumber: account.accountNumber }),
    name: account.name,
    type: account.type ?? account.classification,
    ...(account.subtype === undefined ? {} : { subtype: account.subtype }),
    classification: account.classification,
    ...(account.currencyCode === undefined ? {} : { currencyCode: account.currencyCode }),
    active: account.active ?? true
  };
}

function quickBooksAccountToNativeAccount(account: QuickBooksSdkAccount): NativeLedgerAccount {
  return {
    sourceAccountId: account.Id,
    name: account.Name,
    classification: quickBooksAccountClassification(account.AccountType),
    ...(account.AcctNum === undefined ? {} : { accountNumber: account.AcctNum }),
    type: account.AccountType,
    ...(account.AccountSubType === undefined ? {} : { subtype: account.AccountSubType }),
    active: account.Active ?? true,
    ...(account.CurrencyRef?.value === undefined ? {} : { currencyCode: account.CurrencyRef.value })
  };
}

function quickBooksAccountClassification(accountType: string): AccountClassification {
  const normalized = accountType.toLowerCase().replaceAll(" ", "");
  if (["bank", "accountsreceivable", "othercurrentasset", "fixedasset", "otherasset"].includes(normalized)) {
    return "asset";
  }
  if (["accountspayable", "creditcard", "longtermliability", "othercurrentliability"].includes(normalized)) {
    return "liability";
  }
  if (normalized === "equity") {
    return "equity";
  }
  if (normalized === "income") {
    return "income";
  }
  if (normalized === "costofgoodssold") {
    return "cost_of_goods_sold";
  }
  if (normalized === "otherincome") {
    return "other_income";
  }
  if (normalized === "otherexpense") {
    return "other_expense";
  }
  return "expense";
}

function quickBooksDimensionRefs(detail: QuickBooksSdkJournalEntryLineDetail): DimensionRef[] {
  const refs: DimensionRef[] = [];
  appendQuickBooksDimensionRef(refs, "class", detail.ClassRef);
  appendQuickBooksDimensionRef(refs, "department", detail.DepartmentRef);
  return refs;
}

function appendQuickBooksDimensionRef(refs: DimensionRef[], dimensionKind: string, ref: QuickBooksSdkRef | undefined): void {
  if (ref?.value === undefined) {
    return;
  }
  refs.push({
    dimensionKind,
    sourceDimensionId: ref.value,
    ...(ref.name === undefined ? {} : { name: ref.name })
  });
}

function quickBooksPayloadRef(input: {
  readonly context: SourceAdapterContext;
  readonly sourceObjectType: string;
  readonly sourceObjectId: string;
  readonly sourceUpdatedAt?: IsoDateTime;
  readonly preview: JsonValue;
}): SafeSourcePayloadRef {
  const ref: SafeSourcePayloadRef = {
    sourceObjectType: input.sourceObjectType,
    sourceObjectId: input.sourceObjectId,
    ...(input.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: input.sourceUpdatedAt }),
    storageRef: `quickbooks://${input.context.providerEnvironment}/realm/${input.context.sourceCompanyRef}/${input.sourceObjectType}/${input.sourceObjectId}`,
    preview: input.preview
  };
  assertSafeSourcePayloadRef(ref);
  return ref;
}

function defaultPayloadRef(sourceObjectType: string, sourceObjectId: string, sourceUpdatedAt: IsoDateTime | undefined): SafeSourcePayloadRef {
  return {
    sourceObjectType,
    sourceObjectId,
    ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt })
  };
}

function quickBooksConnectionRef(context: QuickBooksAdapterContext): string {
  const serviceEnvironment = context.runtimeConfig?.serviceEnvironment ?? "production";
  return `handrail-quickbooks-sdk:${serviceEnvironment}:${context.providerEnvironment}:realm:${context.realmId}`;
}

function requiredRefValue(ref: QuickBooksSdkRef, fieldName: string): string {
  if (ref.value === undefined || ref.value.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return ref.value;
}

function requiredMapValue(map: ReadonlyMap<string, string>, key: string, label: string): string {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Unknown ${label} source id: ${key}`);
  }
  return value;
}

function lineAmounts(line: NativeLedgerLine): { readonly debitMinor: bigint; readonly creditMinor: bigint } {
  if (line.debitAmount !== undefined || line.creditAmount !== undefined) {
    const debitMinor = parseMoney(line.debitAmount ?? "0.00");
    const creditMinor = parseMoney(line.creditAmount ?? "0.00");
    if (debitMinor < 0n || creditMinor < 0n) {
      throw new Error("debitAmount and creditAmount must be nonnegative");
    }
    return { debitMinor, creditMinor };
  }

  if (line.amount === undefined) {
    throw new Error("Native ledger line requires amount or debit/credit amounts");
  }

  const amountMinor = parseMoney(line.amount);
  return amountMinor >= 0n ? { debitMinor: amountMinor, creditMinor: 0n } : { debitMinor: 0n, creditMinor: -amountMinor };
}

function parseMoney(value: DecimalString): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Decimal value must have at most two fractional digits: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100n + fraction);
}

function formatMinor(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function decimalFromNumber(value: number | DecimalString): DecimalString {
  if (typeof value === "string") {
    return value;
  }
  if (!Number.isFinite(value)) {
    throw new Error("QuickBooks amount must be finite");
  }
  return value.toFixed(2);
}

function canonicalRecordId(context: SourceAdapterContext, kind: string, sourceObjectId: string): string {
  const digest = createHash("sha256")
    .update([context.tenantId, context.sourceId, context.sourceSystem, context.providerEnvironment, kind, sourceObjectId].join(":"))
    .digest("hex")
    .slice(0, 16);
  return `${kind}_${digest}`;
}

function sourceObjectCounts(accounts: number, transactions: number, postings: number): JsonValue {
  return {
    accounts,
    transactions,
    postings
  };
}
