import { describe, expect, it } from "vitest";

import {
  createRecurringFinancials,
  createErpFinancialsSdk,
  materializeRecurringBillPayment,
  materializeRecurringCashDisbursement,
  materializeRecurringInvoiceDraft,
  planRecurringOccurrences
} from "../src/index.js";

import type { FinancialOperationContext, RecurringOccurrence } from "../src/index.js";

describe("recurring financial command planning", () => {
  it("keeps month-end anchoring instead of drifting after February", () => {
    expect(planRecurringOccurrences({
      scheduleId: "monthly-close",
      rule: { startsOn: "2026-01-31", frequency: "monthly" },
      through: "2026-04-30"
    }).map(({ occurrenceNumber, scheduledFor }) => ({ occurrenceNumber, scheduledFor }))).toEqual([
      { occurrenceNumber: 1, scheduledFor: "2026-01-31" },
      { occurrenceNumber: 2, scheduledFor: "2026-02-28" },
      { occurrenceNumber: 3, scheduledFor: "2026-03-31" },
      { occurrenceNumber: 4, scheduledFor: "2026-04-30" }
    ]);
  });

  it("supports interval, exclusive checkpoint, end date, and leap-year anchoring", () => {
    expect(planRecurringOccurrences({
      scheduleId: "quarterly-shareholder",
      rule: { startsOn: "2026-02-28", frequency: "quarterly", interval: 2, endsOn: "2027-08-31" },
      after: "2026-02-28",
      through: "2028-12-31"
    }).map(({ scheduledFor }) => scheduledFor)).toEqual([
      "2026-08-28",
      "2027-02-28",
      "2027-08-28"
    ]);

    expect(planRecurringOccurrences({
      scheduleId: "leap-year",
      rule: { startsOn: "2024-02-29", frequency: "annual" },
      through: "2028-02-29"
    }).map(({ scheduledFor }) => scheduledFor)).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29"
    ]);
  });

  it("fails closed when a due backlog exceeds the bounded planner request", () => {
    expect(() => planRecurringOccurrences({
      scheduleId: "bounded",
      rule: { startsOn: "2026-01-01", frequency: "monthly" },
      through: "2026-12-31",
      limit: 3
    })).toThrow("backlog exceeds");
  });

  it("materializes a replay-safe invoice draft with payment terms and recurrence provenance", () => {
    const occurrence = firstOccurrence("invoice-monthly", "2026-08-01");
    const draft = materializeRecurringInvoiceDraft({
      operation: operation(),
      occurrence,
      template: {
        kind: "invoice_draft",
        scheduleId: "invoice-monthly",
        rule: { startsOn: "2026-08-01", frequency: "monthly" },
        customerId: "customer-1",
        receivableAccount: { accountId: "accounts-receivable" },
        documentNumberPrefix: "INV-R",
        paymentTermsDays: 30,
        memo: "Monthly managed services",
        metadata: { contractRef: "contract-1" },
        revenueLines: [{ accountId: "managed-services-income", amount: "125.00" }]
      }
    });
    expect(draft).toEqual(expect.objectContaining({
      idempotencyKey: "recurring:invoice-monthly:2026-08-01:invoice-draft",
      documentNumber: "INV-R-20260801",
      documentDate: "2026-08-01",
      dueDate: "2026-08-31"
    }));
    expect(draft.metadata).toEqual({
      contractRef: "contract-1",
      recurringSchedule: {
        scheduleId: "invoice-monthly",
        occurrenceId: occurrence.occurrenceId,
        occurrenceNumber: 1,
        scheduledFor: "2026-08-01"
      }
    });
  });

  it("requires the host to bind each recurring vendor payment to exact current bills", () => {
    const occurrence = firstOccurrence("office-rent", "2026-09-01");
    expect(materializeRecurringBillPayment({
      operation: operation(),
      occurrence,
      allocations: [{ billId: "bill-september", amount: "900.00", expectedBillVersion: 1 }],
      template: {
        kind: "bill_payment",
        scheduleId: "office-rent",
        rule: { startsOn: "2026-09-01", frequency: "monthly" },
        vendorId: "landlord",
        amount: "900.00",
        paymentMethod: "ach",
        documentNumberPrefix: "PAY-RENT",
        referencePrefix: "RENT",
        payableAccount: { accountId: "accounts-payable" },
        cashAccount: { accountId: "operating-cash" }
      }
    })).toEqual(expect.objectContaining({
      idempotencyKey: "recurring:office-rent:2026-09-01:bill-payment",
      date: "2026-09-01",
      documentNumber: "PAY-RENT-20260901",
      reference: "RENT-20260901",
      allocations: [{ billId: "bill-september", amount: "900.00", expectedBillVersion: 1 }]
    }));
  });

  it("classifies shareholder distributions through an explicit debit account instead of A/P", () => {
    const occurrence = firstOccurrence("shareholder-distribution", "2026-08-15");
    expect(materializeRecurringCashDisbursement({
      operation: operation(),
      occurrence,
      template: {
        kind: "cash_disbursement",
        scheduleId: "shareholder-distribution",
        rule: { startsOn: "2026-08-15", frequency: "monthly" },
        payeeId: "shareholder-1",
        amount: "2500.00",
        documentNumberPrefix: "DIST",
        memo: "Approved shareholder distribution",
        debitAccount: { accountId: "shareholder-distributions" },
        cashAccount: { accountId: "operating-cash" }
      }
    })).toEqual(expect.objectContaining({
      idempotencyKey: "recurring:shareholder-distribution:2026-08-15:cash-disbursement",
      transactionNumber: "DIST-20260815",
      lines: [
        expect.objectContaining({
          accountId: "shareholder-distributions",
          partyId: "shareholder-1",
          debit: "2500.00"
        }),
        expect.objectContaining({ accountId: "operating-cash", credit: "2500.00" })
      ]
    }));
  });

  it("exposes recurrence planning from the compact SDK helper", () => {
    const recurring = createRecurringFinancials();
    expect(recurring.plan({
      scheduleId: "sdk-plan",
      rule: { startsOn: "2026-08-01", frequency: "monthly" },
      through: "2026-08-01"
    })).toHaveLength(1);

    const sdk = createErpFinancialsSdk({
      database: {
        transaction: async () => Promise.reject(new Error("recurrence planning must not open a transaction"))
      },
      tenantId: "tenant-1",
      companyId: "company-1",
      bookId: "book-1",
      writeSourceId: "native-source",
      currencyCode: "USD"
    });
    expect(sdk.recurring.plan({
      scheduleId: "sdk-surface",
      rule: { startsOn: "2026-08-01", frequency: "monthly" },
      through: "2026-08-01"
    })).toHaveLength(1);
  });

  it("rejects an occurrence forged for a different schedule", () => {
    const occurrence = firstOccurrence("schedule-a", "2026-08-01");
    expect(() => materializeRecurringCashDisbursement({
      operation: operation(),
      occurrence,
      template: {
        kind: "cash_disbursement",
        scheduleId: "schedule-b",
        rule: { startsOn: "2026-08-01", frequency: "monthly" },
        amount: "1.00",
        debitAccount: { accountId: "distribution" },
        cashAccount: { accountId: "cash" }
      }
    })).toThrow("must match");
  });
});

function firstOccurrence(scheduleId: string, startsOn: string): RecurringOccurrence {
  const planned = planRecurringOccurrences({
    scheduleId,
    rule: { startsOn, frequency: "monthly" },
    through: startsOn
  });
  const first = planned[0];
  if (first === undefined) throw new Error("Expected the recurrence anchor occurrence");
  return first;
}

function operation(): FinancialOperationContext {
  return {
    actorRef: "principal-scheduler",
    requestId: "request-recurring",
    correlationId: "correlation-recurring",
    reasonCode: "scheduled_financial_occurrence",
    occurredAt: "2026-08-28T12:00:00.000Z"
  };
}
