import { createHash } from "node:crypto";

import { assertNoCredentialKeys } from "./canonical-model.js";
import { ErpFinancialsValidationError } from "./erp-financials-service.js";
import { assertFinancialOperationContext } from "./financial-lifecycle.js";

import type { DecimalString, DimensionRef, IsoCurrencyCode, IsoDate, JsonValue } from "./canonical-model.js";
import type {
  BillPaymentAllocationInput,
  BillPaymentMethod,
  ErpFinancialsAccountReference,
  PostJournalEntryInput,
  ScheduleBillPaymentInput,
  SubledgerAmountLine
} from "./erp-financials-service.js";
import type { FinancialOperationContext } from "./financial-lifecycle.js";
import type { SaveInvoiceDraftInput } from "./invoice-workflow.js";

const DEFAULT_OCCURRENCE_LIMIT = 100;
const MAX_OCCURRENCE_LIMIT = 500;
const MAX_INTERVAL = 120;
const MAX_PAYMENT_TERMS_DAYS = 3650;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_PREFIX_LENGTH = 80;

export type RecurrenceFrequency = "monthly" | "quarterly" | "annual";

/**
 * An anchored calendar recurrence. Month-end dates remain month-end instead
 * of drifting after a shorter month (Jan 31 -> Feb 28 -> Mar 31).
 */
export type RecurrenceRule = {
  readonly startsOn: IsoDate;
  readonly frequency: RecurrenceFrequency;
  readonly interval?: number;
  readonly endsOn?: IsoDate;
};

export type PlanRecurringOccurrencesInput = {
  readonly scheduleId: string;
  readonly rule: RecurrenceRule;
  /** Return occurrences strictly after this date. */
  readonly after?: IsoDate;
  /** Return occurrences on or before this date. */
  readonly through: IsoDate;
  readonly limit?: number;
};

export type RecurringOccurrence = {
  readonly occurrenceId: string;
  readonly scheduleId: string;
  readonly occurrenceNumber: number;
  readonly scheduledFor: IsoDate;
  readonly idempotencyKey: string;
};

type RecurringTemplateBase = {
  readonly scheduleId: string;
  readonly rule: RecurrenceRule;
  readonly documentNumberPrefix?: string;
  readonly memo?: string;
};

export type RecurringInvoiceDraftTemplate = RecurringTemplateBase & {
  readonly kind: "invoice_draft";
  readonly customerId: string;
  readonly receivableAccount: ErpFinancialsAccountReference;
  readonly paymentTermsDays: number;
  readonly currencyCode?: IsoCurrencyCode;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly revenueLines: readonly SubledgerAmountLine[];
};

export type MaterializeRecurringInvoiceDraftInput = {
  readonly operation: FinancialOperationContext;
  readonly template: RecurringInvoiceDraftTemplate;
  readonly occurrence: RecurringOccurrence;
};

/**
 * A recurring vendor-payment envelope. The host resolves the exact open bills
 * and optimistic versions for each occurrence; the SDK never guesses which
 * payable balance should be reduced.
 */
export type RecurringBillPaymentTemplate = RecurringTemplateBase & {
  readonly kind: "bill_payment";
  readonly vendorId: string;
  readonly amount: DecimalString;
  readonly paymentMethod: BillPaymentMethod;
  readonly referencePrefix?: string;
  readonly currencyCode?: IsoCurrencyCode;
  readonly payableAccount: ErpFinancialsAccountReference;
  readonly cashAccount: ErpFinancialsAccountReference;
};

export type MaterializeRecurringBillPaymentInput = {
  readonly operation: FinancialOperationContext;
  readonly template: RecurringBillPaymentTemplate;
  readonly occurrence: RecurringOccurrence;
  readonly allocations: readonly BillPaymentAllocationInput[];
};

/**
 * A non-A/P cash disbursement such as an approved shareholder distribution.
 * The debit account determines the accounting classification; the package
 * does not infer that a payee is a vendor or that a distribution is expense.
 */
export type RecurringCashDisbursementTemplate = RecurringTemplateBase & {
  readonly kind: "cash_disbursement";
  readonly payeeId?: string;
  readonly amount: DecimalString;
  readonly currencyCode?: IsoCurrencyCode;
  readonly debitAccount: ErpFinancialsAccountReference;
  readonly cashAccount: ErpFinancialsAccountReference;
  readonly dimensionRefs?: readonly DimensionRef[];
};

export type MaterializeRecurringCashDisbursementInput = {
  readonly operation: FinancialOperationContext;
  readonly template: RecurringCashDisbursementTemplate;
  readonly occurrence: RecurringOccurrence;
};

export type RecurringFinancials = {
  plan(input: PlanRecurringOccurrencesInput): readonly RecurringOccurrence[];
  invoiceDraft(input: MaterializeRecurringInvoiceDraftInput): SaveInvoiceDraftInput;
  billPayment(input: MaterializeRecurringBillPaymentInput): ScheduleBillPaymentInput;
  cashDisbursement(input: MaterializeRecurringCashDisbursementInput): PostJournalEntryInput;
};

export function createRecurringFinancials(): RecurringFinancials {
  return {
    plan: planRecurringOccurrences,
    invoiceDraft: materializeRecurringInvoiceDraft,
    billPayment: materializeRecurringBillPayment,
    cashDisbursement: materializeRecurringCashDisbursement
  };
}

export function planRecurringOccurrences(
  input: PlanRecurringOccurrencesInput
): readonly RecurringOccurrence[] {
  assertIdentifier(input.scheduleId, "scheduleId");
  const rule = validateRule(input.rule);
  const through = parseIsoDate(input.through, "through");
  const after = input.after === undefined ? undefined : parseIsoDate(input.after, "after");
  if (after !== undefined && after.getTime() >= through.getTime()) return [];
  const limit = input.limit ?? DEFAULT_OCCURRENCE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OCCURRENCE_LIMIT) {
    invalid(`limit must be an integer between 1 and ${String(MAX_OCCURRENCE_LIMIT)}`);
  }

  const results: RecurringOccurrence[] = [];
  for (let occurrenceNumber = 1; ; occurrenceNumber += 1) {
    const scheduledDate = occurrenceDate(rule, occurrenceNumber);
    if (scheduledDate.getTime() > through.getTime()) break;
    const scheduledFor = isoDate(scheduledDate);
    if (rule.endsOn !== undefined && scheduledFor > rule.endsOn) break;
    if (after !== undefined && scheduledDate.getTime() <= after.getTime()) continue;
    if (results.length === limit) {
      invalid(`recurring occurrence backlog exceeds the requested limit of ${String(limit)}`);
    }
    results.push(occurrence(input.scheduleId, occurrenceNumber, scheduledFor));
  }
  return results;
}

export function materializeRecurringInvoiceDraft(
  input: MaterializeRecurringInvoiceDraftInput
): SaveInvoiceDraftInput {
  assertFinancialOperationContext(input.operation);
  assertOccurrenceMatchesTemplate(input.template, input.occurrence);
  assertIdentifier(input.template.customerId, "template.customerId");
  assertPaymentTerms(input.template.paymentTermsDays);
  assertPrefix(input.template.documentNumberPrefix, "template.documentNumberPrefix");
  if (input.template.revenueLines.length === 0) invalid("template.revenueLines must not be empty");
  const metadata = input.template.metadata ?? {};
  assertNoCredentialKeys(metadata);
  const generatedDocumentNumber = documentNumber(
    input.template.documentNumberPrefix,
    input.occurrence.scheduledFor
  );
  return {
    operation: input.operation,
    idempotencyKey: `${input.occurrence.idempotencyKey}:invoice-draft`,
    customerId: input.template.customerId,
    receivableAccount: input.template.receivableAccount,
    ...(generatedDocumentNumber === undefined ? {} : { documentNumber: generatedDocumentNumber }),
    documentDate: input.occurrence.scheduledFor,
    dueDate: addDays(input.occurrence.scheduledFor, input.template.paymentTermsDays),
    ...(input.template.currencyCode === undefined ? {} : { currencyCode: input.template.currencyCode }),
    ...(input.template.memo === undefined ? {} : { memo: input.template.memo }),
    metadata: {
      ...metadata,
      recurringSchedule: {
        scheduleId: input.template.scheduleId,
        occurrenceId: input.occurrence.occurrenceId,
        occurrenceNumber: input.occurrence.occurrenceNumber,
        scheduledFor: input.occurrence.scheduledFor
      }
    },
    revenueLines: input.template.revenueLines
  };
}

export function materializeRecurringBillPayment(
  input: MaterializeRecurringBillPaymentInput
): ScheduleBillPaymentInput {
  assertFinancialOperationContext(input.operation);
  assertOccurrenceMatchesTemplate(input.template, input.occurrence);
  assertIdentifier(input.template.vendorId, "template.vendorId");
  assertPrefix(input.template.documentNumberPrefix, "template.documentNumberPrefix");
  assertPrefix(input.template.referencePrefix, "template.referencePrefix");
  if (input.allocations.length === 0) invalid("allocations must not be empty");
  const generatedDocumentNumber = documentNumber(
    input.template.documentNumberPrefix,
    input.occurrence.scheduledFor
  );
  const generatedReference = documentNumber(input.template.referencePrefix, input.occurrence.scheduledFor);
  return {
    operation: input.operation,
    idempotencyKey: `${input.occurrence.idempotencyKey}:bill-payment`,
    date: input.occurrence.scheduledFor,
    ...(generatedDocumentNumber === undefined ? {} : { documentNumber: generatedDocumentNumber }),
    ...(input.template.memo === undefined ? {} : { memo: input.template.memo }),
    vendorId: input.template.vendorId,
    amount: input.template.amount,
    paymentMethod: input.template.paymentMethod,
    ...(generatedReference === undefined ? {} : { reference: generatedReference }),
    ...(input.template.currencyCode === undefined ? {} : { currencyCode: input.template.currencyCode }),
    payableAccount: input.template.payableAccount,
    cashAccount: input.template.cashAccount,
    allocations: input.allocations
  };
}

export function materializeRecurringCashDisbursement(
  input: MaterializeRecurringCashDisbursementInput
): PostJournalEntryInput {
  assertFinancialOperationContext(input.operation);
  assertOccurrenceMatchesTemplate(input.template, input.occurrence);
  if (input.template.payeeId !== undefined) assertIdentifier(input.template.payeeId, "template.payeeId");
  assertPrefix(input.template.documentNumberPrefix, "template.documentNumberPrefix");
  const description = input.template.memo ?? "Recurring cash disbursement";
  const generatedDocumentNumber = documentNumber(
    input.template.documentNumberPrefix,
    input.occurrence.scheduledFor
  );
  return {
    operation: input.operation,
    idempotencyKey: `${input.occurrence.idempotencyKey}:cash-disbursement`,
    date: input.occurrence.scheduledFor,
    ...(generatedDocumentNumber === undefined ? {} : { transactionNumber: generatedDocumentNumber }),
    memo: description,
    ...(input.template.currencyCode === undefined ? {} : { currencyCode: input.template.currencyCode }),
    lines: [
      {
        ...input.template.debitAccount,
        debit: input.template.amount,
        description,
        ...(input.template.payeeId === undefined ? {} : { partyId: input.template.payeeId }),
        ...(input.template.dimensionRefs === undefined ? {} : { dimensionRefs: input.template.dimensionRefs })
      },
      {
        ...input.template.cashAccount,
        credit: input.template.amount,
        description
      }
    ]
  };
}

function validateRule(rule: RecurrenceRule): Required<Pick<RecurrenceRule, "startsOn" | "frequency" | "interval">> & Pick<RecurrenceRule, "endsOn"> {
  const startsOn = isoDate(parseIsoDate(rule.startsOn, "rule.startsOn"));
  if (!["monthly", "quarterly", "annual"].includes(rule.frequency)) {
    invalid("rule.frequency must be monthly, quarterly, or annual");
  }
  const interval = rule.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    invalid(`rule.interval must be an integer between 1 and ${String(MAX_INTERVAL)}`);
  }
  const endsOn = rule.endsOn === undefined ? undefined : isoDate(parseIsoDate(rule.endsOn, "rule.endsOn"));
  if (endsOn !== undefined && endsOn < startsOn) invalid("rule.endsOn must not precede rule.startsOn");
  return { startsOn, frequency: rule.frequency, interval, ...(endsOn === undefined ? {} : { endsOn }) };
}

function occurrenceDate(
  rule: ReturnType<typeof validateRule>,
  occurrenceNumber: number
): Date {
  const anchor = parseIsoDate(rule.startsOn, "rule.startsOn");
  const monthsPerFrequency = rule.frequency === "annual" ? 12 : rule.frequency === "quarterly" ? 3 : 1;
  const monthOffset = (occurrenceNumber - 1) * monthsPerFrequency * rule.interval;
  const targetMonthIndex = anchor.getUTCMonth() + monthOffset;
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(anchor.getUTCDate(), daysInMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, targetDay));
}

function occurrence(scheduleId: string, occurrenceNumber: number, scheduledFor: IsoDate): RecurringOccurrence {
  const digest = createHash("sha256")
    .update(JSON.stringify({ scheduleId, occurrenceNumber, scheduledFor }))
    .digest("hex")
    .slice(0, 32);
  return {
    occurrenceId: `recurring_occurrence_${digest}`,
    scheduleId,
    occurrenceNumber,
    scheduledFor,
    idempotencyKey: `recurring:${scheduleId}:${scheduledFor}`
  };
}

function assertOccurrenceMatchesTemplate(
  template: RecurringTemplateBase,
  occurrenceValue: RecurringOccurrence
): void {
  assertIdentifier(template.scheduleId, "template.scheduleId");
  const rule = validateRule(template.rule);
  assertIdentifier(occurrenceValue.occurrenceId, "occurrence.occurrenceId");
  if (occurrenceValue.scheduleId !== template.scheduleId) {
    invalid("occurrence.scheduleId must match template.scheduleId");
  }
  if (!Number.isInteger(occurrenceValue.occurrenceNumber) || occurrenceValue.occurrenceNumber < 1) {
    invalid("occurrence.occurrenceNumber must be a positive integer");
  }
  const expectedDate = isoDate(occurrenceDate(rule, occurrenceValue.occurrenceNumber));
  if (rule.endsOn !== undefined && expectedDate > rule.endsOn) {
    invalid("occurrence falls after the template recurrence end date");
  }
  if (occurrenceValue.scheduledFor !== expectedDate) {
    invalid("occurrence.scheduledFor does not match the template recurrence rule");
  }
  const expected = occurrence(template.scheduleId, occurrenceValue.occurrenceNumber, expectedDate);
  if (occurrenceValue.occurrenceId !== expected.occurrenceId || occurrenceValue.idempotencyKey !== expected.idempotencyKey) {
    invalid("occurrence identity does not match the deterministic recurrence identity");
  }
}

function addDays(date: IsoDate, days: number): IsoDate {
  const value = parseIsoDate(date, "date");
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function documentNumber(prefix: string | undefined, date: IsoDate): string | undefined {
  return prefix === undefined ? undefined : `${prefix}-${date.replaceAll("-", "")}`;
}

function assertPaymentTerms(days: number): void {
  if (!Number.isInteger(days) || days < 0 || days > MAX_PAYMENT_TERMS_DAYS) {
    invalid(`template.paymentTermsDays must be an integer between 0 and ${String(MAX_PAYMENT_TERMS_DAYS)}`);
  }
}

function assertIdentifier(value: string, field: string): void {
  if (value.trim().length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    invalid(`${field} must be non-empty and at most ${String(MAX_IDENTIFIER_LENGTH)} characters`);
  }
}

function assertPrefix(value: string | undefined, field: string): void {
  if (value === undefined) return;
  if (value.trim().length === 0 || value.length > MAX_PREFIX_LENGTH) {
    invalid(`${field} must be non-empty and at most ${String(MAX_PREFIX_LENGTH)} characters`);
  }
}

function parseIsoDate(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) invalid(`${field} must be an ISO date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== value) invalid(`${field} must be an ISO date`);
  return parsed;
}

function isoDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

function daysInMonth(year: number, zeroBasedMonth: number): number {
  return new Date(Date.UTC(year, zeroBasedMonth + 1, 0)).getUTCDate();
}

function invalid(message: string): never {
  throw new ErpFinancialsValidationError(message);
}
