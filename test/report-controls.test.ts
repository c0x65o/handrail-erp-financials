import { describe, expect, it } from "vitest";

import {
  ERP_FINANCIALS_STATEMENT_FIXTURE,
  STANDARD_REPORT_ACCOUNTING_METHODS,
  STANDARD_REPORT_COMPARISON_CALCULATION_OPTIONS,
  STANDARD_REPORT_COMPARE_TO_PERIOD_OPTIONS,
  STANDARD_REPORT_DISPLAY_COLUMNS_BY_OPTIONS,
  assertStandardReportControlsSupported,
  buildProfitAndLossReport,
  buildReferenceStandardReportPresentationFromFacts,
  buildStandardReportPresentationFromFacts,
  buildStandardReportPresentationFromReadModel
} from "../src/index.js";

import type {
  LedgerPosting,
  ReportBuilderInput,
  StandardReportPresentationReadModelRequest,
  StandardReportPresentationReadModelStorage,
  StandardReportPresentationReportSet,
  TransactionLine
} from "../src/index.js";

const fixture = ERP_FINANCIALS_STATEMENT_FIXTURE;

describe("standard report controls", () => {
  it("exports every accounting method, display-column, compare-to, and calculation option from the report UI", () => {
    expect(STANDARD_REPORT_ACCOUNTING_METHODS.map((option) => option.value)).toEqual(["cash", "accrual"]);
    expect(STANDARD_REPORT_DISPLAY_COLUMNS_BY_OPTIONS.map((option) => option.value)).toEqual([
      "none",
      "customer",
      "employee",
      "product_service",
      "days",
      "weeks",
      "months",
      "quarters",
      "years",
      "vendor"
    ]);
    expect(STANDARD_REPORT_COMPARE_TO_PERIOD_OPTIONS.map((option) => option.value)).toEqual([
      "previous_year",
      "previous_period",
      "year_to_date",
      "previous_year_to_date",
      "custom_period"
    ]);
    expect(STANDARD_REPORT_COMPARISON_CALCULATION_OPTIONS.map((option) => option.value)).toEqual([
      "percent_of_row",
      "percent_of_column",
      "percent_of_expense",
      "percent_of_income"
    ]);
  });

  it("builds comparison columns for all compare-to periods and calculation options", () => {
    const presentation = buildReferenceStandardReportPresentationFromFacts({
      reportName: "profit_and_loss",
      reportInput: enrichedReportInput(),
      accountingMethod: "accrual",
      compareTo: {
        periods: ["previous_year", "previous_period", "year_to_date", "previous_year_to_date", "custom_period"],
        customPeriod: {
          periodStart: "2026-01-01",
          periodEnd: "2026-01-15"
        },
        calculations: ["percent_of_row", "percent_of_column", "percent_of_expense", "percent_of_income"]
      },
      fiscalYearStartMonth: fixture.company.fiscalYearStartMonth
    });

    expect(presentation.accountingMethod).toBe("accrual");
    expect(presentation.columns.map((column) => column.columnId)).toEqual([
      "actual:none:total",
      "comparison:previous_year",
      "comparison:previous_period",
      "comparison:year_to_date",
      "comparison:previous_year_to_date",
      "comparison:custom_period",
      "calculation:percent_of_row",
      "calculation:percent_of_column",
      "calculation:percent_of_expense",
      "calculation:percent_of_income"
    ]);
    expect(presentation.columns.find((column) => column.columnId === "comparison:previous_year")).toMatchObject({
      periodStart: "2025-01-01",
      periodEnd: "2025-01-31",
      asOfDate: "2025-01-31"
    });
    expect(presentation.columns.find((column) => column.columnId === "comparison:previous_period")).toMatchObject({
      periodStart: "2025-12-01",
      periodEnd: "2025-12-31",
      asOfDate: "2025-12-31"
    });
    expect(presentation.columns.find((column) => column.columnId === "comparison:custom_period")).toMatchObject({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-15",
      asOfDate: "2026-01-15"
    });
    expect(rowCell(presentation, "total:net_income", "actual:none:total")?.amount).toBe("13800.00");
    expect(rowCell(presentation, "total:net_income", "calculation:percent_of_income")?.percent).toBe("69.00");
  });

  it.each([
    ["customer", ["Acme Stores"]],
    ["employee", ["Primary Owner"]],
    ["product_service", ["Installation", "Production Equipment", "Widget"]],
    ["vendor", ["Landlord LLC", "Supply Vendor"]]
  ] as const)("builds %s display columns from posting dimensions", (displayColumnsBy, expectedLabels) => {
    const presentation = buildReferenceStandardReportPresentationFromFacts({
      reportName: "profit_and_loss",
      reportInput: enrichedReportInput(),
      displayColumnsBy,
      parties: fixture.parties,
      items: fixture.items
    });

    expect(presentation.columns.map((column) => column.label)).toEqual(expectedLabels);
    expect(presentation.columns.every((column) => column.displayColumnsBy === displayColumnsBy)).toBe(true);
  });

  it.each([
    ["days", ["2026-01-01", "2026-01-02", "2026-01-03"]],
    ["weeks", ["2026-01-01 - 2026-01-03", "2026-01-04 - 2026-01-10", "2026-01-11 - 2026-01-17"]],
    ["months", ["01/2026"]],
    ["quarters", ["Q1 2026"]],
    ["years", ["2026"]]
  ] as const)("builds %s display columns from the report period", (displayColumnsBy, expectedStartingLabels) => {
    const presentation = buildReferenceStandardReportPresentationFromFacts({
      reportName: "profit_and_loss",
      reportInput: enrichedReportInput(),
      displayColumnsBy,
      weekStartsOn: 0
    });

    expect(presentation.columns.slice(0, expectedStartingLabels.length).map((column) => column.label)).toEqual(expectedStartingLabels);
    expect(presentation.columns.every((column) => column.displayColumnsBy === displayColumnsBy)).toBe(true);
  });

  it("supports cash-basis presentation requests when cash-basis postings are available", () => {
    const reportInput = {
      ...enrichedReportInput(),
      accountingBasis: "cash" as const,
      postings: enrichedReportInput().postings.map((posting) => ({
        ...posting,
        accountingBasis: "cash" as const
      }))
    } satisfies ReportBuilderInput;
    const presentation = buildReferenceStandardReportPresentationFromFacts({
      reportName: "profit_and_loss",
      reportInput,
      accountingMethod: "cash"
    });

    expect(presentation.accountingMethod).toBe("cash");
    expect(rowCell(presentation, "total:net_income", "actual:none:total")?.amount).toBe("13800.00");
  });

  it("builds the production presentation surface from a read model request without raw postings", async () => {
    const storage = new RecordingPresentationReadModelStorage();

    const presentation = await buildStandardReportPresentationFromReadModel(storage, {
      tenantId: fixture.company.tenantId,
      companyId: fixture.company.companyId,
      sourceId: fixture.source.sourceId,
      reportName: "profit_and_loss",
      accountingMethod: "accrual",
      periodStart: "2026-01-01",
      periodEnd: "2027-12-31",
      asOfDate: "2027-12-31",
      currencyCode: "USD",
      displayColumnsBy: "months"
    });

    expect(storage.requests).toHaveLength(1);
    expect(Object.hasOwn(storage.requests[0] ?? {}, "reportInput")).toBe(false);
    expect(presentation.columns.map((column) => column.columnId)).toEqual(["actual:months:2026-01"]);
    expect(rowCell(presentation, "total:net_income", "actual:months:2026-01")?.amount).toBe("13800.00");
  });

  it("keeps the deprecated raw-facts alias only as reference fixture compatibility", () => {
    expect(buildStandardReportPresentationFromFacts).toBe(buildReferenceStandardReportPresentationFromFacts);

    const presentation = buildStandardReportPresentationFromFacts({
      reportName: "profit_and_loss",
      reportInput: enrichedReportInput()
    });

    expect(presentation.columns.map((column) => column.columnId)).toEqual(["actual:none:total"]);
    expect(rowCell(presentation, "total:net_income", "actual:none:total")?.amount).toBe("13800.00");
  });

  it("rejects unsupported accounting basis and missing custom comparison periods", () => {
    expect(() => {
      assertStandardReportControlsSupported({
        reportName: "profit_and_loss",
        reportInput: {
          ...enrichedReportInput(),
          accountingBasis: "modified_cash"
        }
      });
    }).toThrow(/accounting method/);

    expect(() => {
      assertStandardReportControlsSupported({
        reportName: "profit_and_loss",
        reportInput: enrichedReportInput(),
        compareTo: {
          periods: ["custom_period"]
        }
      });
    }).toThrow(/customPeriod/);
  });
});

class RecordingPresentationReadModelStorage implements StandardReportPresentationReadModelStorage {
  readonly requests: StandardReportPresentationReadModelRequest[] = [];

  loadStandardReportPresentation(request: StandardReportPresentationReadModelRequest): Promise<StandardReportPresentationReportSet> {
    this.requests.push(request);
    const reportInput = enrichedReportInput();
    const report = buildProfitAndLossReport(reportInput);

    return Promise.resolve({
      reportName: "profit_and_loss",
      accountingMethod: "accrual",
      displayColumnsBy: "months",
      primaryReport: report,
      amountColumns: [
        {
          column: {
            columnId: "actual:months:2026-01",
            label: "01/2026",
            kind: "actual",
            periodStart: reportInput.periodStart,
            periodEnd: reportInput.periodEnd,
            asOfDate: reportInput.asOfDate ?? reportInput.periodEnd,
            displayColumnsBy: "months",
            groupKey: "2026-01"
          },
          report
        }
      ]
    });
  }
}

function enrichedReportInput(): ReportBuilderInput {
  const lineById = new Map(fixture.transactionLines.map((line) => [line.transactionLineId, line]));
  return {
    ...fixture.reportRequest,
    accounts: fixture.accounts,
    postings: fixture.postings.map((posting) =>
      postingWithLineDimensions(posting, posting.transactionLineId === undefined ? undefined : lineById.get(posting.transactionLineId))
    ),
    freshness: {
      status: "fresh",
      sourceId: fixture.source.sourceId,
      importBatchId: fixture.importBatch.importBatchId,
      checkpointId: fixture.checkpoint.checkpointId,
      freshThrough: "2026-02-01T00:00:00.000Z"
    }
  };
}

function postingWithLineDimensions(posting: LedgerPosting, line: TransactionLine | undefined): LedgerPosting {
  return {
    ...posting,
    ...(line?.partyId === undefined ? {} : { partyId: line.partyId }),
    ...(line?.itemId === undefined ? {} : { itemId: line.itemId })
  };
}

function rowCell(
  presentation: ReturnType<typeof buildReferenceStandardReportPresentationFromFacts>,
  rowId: string,
  columnId: string
): { readonly amount?: string; readonly percent?: string } | undefined {
  return presentation.rows.find((row) => row.rowId === rowId)?.cells.find((cell) => cell.columnId === columnId);
}
