import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildProfitAndLossReport,
  buildTrialBalanceReport
} from "./report-builders.js";
import type {
  AccountingBasis,
  DecimalString,
  IsoDate,
  Item,
  LedgerPosting,
  Party
} from "./canonical-model.js";
import type { BuiltReport, CashFlowBuilderInput, ReportBuilderInput, ReportName } from "./report-builders.js";

export type StandardReportAccountingMethod = Extract<AccountingBasis, "cash" | "accrual">;

export type StandardReportDisplayColumnsBy =
  | "none"
  | "customer"
  | "employee"
  | "product_service"
  | "days"
  | "weeks"
  | "months"
  | "quarters"
  | "years"
  | "vendor";

export type StandardReportCompareToPeriod =
  | "previous_year"
  | "previous_period"
  | "year_to_date"
  | "previous_year_to_date"
  | "custom_period";

export type StandardReportComparisonCalculation =
  | "percent_of_row"
  | "percent_of_column"
  | "percent_of_expense"
  | "percent_of_income";

export type StandardReportControlOption<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
};

export const STANDARD_REPORT_ACCOUNTING_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "accrual", label: "Accrual" }
] as const satisfies readonly StandardReportControlOption<StandardReportAccountingMethod>[];

export const STANDARD_REPORT_DISPLAY_COLUMNS_BY_OPTIONS = [
  { value: "none", label: "Select" },
  { value: "customer", label: "Customer" },
  { value: "employee", label: "Employee" },
  { value: "product_service", label: "Product/Service" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "quarters", label: "Quarters" },
  { value: "years", label: "Years" },
  { value: "vendor", label: "Vendor" }
] as const satisfies readonly StandardReportControlOption<StandardReportDisplayColumnsBy>[];

export const STANDARD_REPORT_COMPARE_TO_PERIOD_OPTIONS = [
  { value: "previous_year", label: "Previous year (PY)" },
  { value: "previous_period", label: "Previous Period (PP)" },
  { value: "year_to_date", label: "Year-to-date (YTD)" },
  { value: "previous_year_to_date", label: "Previous year-to-date (PY YTD)" },
  { value: "custom_period", label: "Custom period (CP)" }
] as const satisfies readonly StandardReportControlOption<StandardReportCompareToPeriod>[];

export const STANDARD_REPORT_COMPARISON_CALCULATION_OPTIONS = [
  { value: "percent_of_row", label: "% of Row" },
  { value: "percent_of_column", label: "% of Column" },
  { value: "percent_of_expense", label: "% of Expense" },
  { value: "percent_of_income", label: "% of Income" }
] as const satisfies readonly StandardReportControlOption<StandardReportComparisonCalculation>[];

export type StandardReportCompareToRequest = {
  readonly periods?: readonly StandardReportCompareToPeriod[];
  readonly customPeriod?: {
    readonly periodStart: IsoDate;
    readonly periodEnd: IsoDate;
    readonly asOfDate?: IsoDate;
  };
  readonly calculations?: readonly StandardReportComparisonCalculation[];
};

export type StandardReportPresentationRequest = {
  readonly reportName: ReportName;
  readonly reportInput: ReportBuilderInput;
  readonly cashFlow?: Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId">;
  readonly accountingMethod?: StandardReportAccountingMethod;
  readonly displayColumnsBy?: StandardReportDisplayColumnsBy;
  readonly compareTo?: StandardReportCompareToRequest;
  readonly parties?: readonly Party[];
  readonly items?: readonly Item[];
  readonly fiscalYearStartMonth?: number;
  readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
};

export type StandardReportColumnKind = "actual" | "comparison" | "calculation";

export type StandardReportPresentationColumn = {
  readonly columnId: string;
  readonly label: string;
  readonly kind: StandardReportColumnKind;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate: IsoDate;
  readonly displayColumnsBy: StandardReportDisplayColumnsBy;
  readonly compareTo?: StandardReportCompareToPeriod;
  readonly calculation?: StandardReportComparisonCalculation;
  readonly groupKey?: string;
};

export type StandardReportPresentationCell = {
  readonly columnId: string;
  readonly amount?: DecimalString;
  readonly percent?: DecimalString;
};

export type StandardReportPresentationRowKind = "line" | "total";

export type StandardReportPresentationRow = {
  readonly rowId: string;
  readonly kind: StandardReportPresentationRowKind;
  readonly label: string;
  readonly section?: string;
  readonly totalKey?: string;
  readonly cells: readonly StandardReportPresentationCell[];
};

export type StandardReportPresentation = {
  readonly reportName: ReportName;
  readonly accountingMethod: StandardReportAccountingMethod;
  readonly displayColumnsBy: StandardReportDisplayColumnsBy;
  readonly columns: readonly StandardReportPresentationColumn[];
  readonly rows: readonly StandardReportPresentationRow[];
  readonly primaryReport: BuiltReport;
  readonly comparisonReports: Readonly<Record<string, BuiltReport>>;
};

type AmountColumnBuildSpec = {
  readonly column: StandardReportPresentationColumn;
  readonly reportInput: ReportBuilderInput;
};

type DisplayColumnGroup = {
  readonly key: string;
  readonly label: string;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly asOfDate?: IsoDate;
  readonly postings?: readonly LedgerPosting[];
};

type RowSeed = {
  readonly rowId: string;
  readonly kind: StandardReportPresentationRowKind;
  readonly label: string;
  readonly section?: string;
  readonly totalKey?: string;
};

const ZERO = "0.00";
const ONE_HUNDRED = 10000n;
const MONTHS_PER_YEAR = 12;

export function assertStandardReportAccountingMethod(value: AccountingBasis): asserts value is StandardReportAccountingMethod {
  if (value !== "cash" && value !== "accrual") {
    throw new Error(`Standard report accounting method is not supported by the UI controls: ${value}`);
  }
}

export function assertStandardReportControlsSupported(request: StandardReportPresentationRequest): void {
  assertStandardReportAccountingMethod(request.accountingMethod ?? request.reportInput.accountingBasis);
  assertDisplayColumnsBySupported(request.displayColumnsBy ?? "none");

  for (const period of request.compareTo?.periods ?? []) {
    assertCompareToPeriodSupported(period);
  }
  for (const calculation of request.compareTo?.calculations ?? []) {
    assertComparisonCalculationSupported(calculation);
  }
  if (request.compareTo?.periods?.includes("custom_period") === true && request.compareTo.customPeriod === undefined) {
    throw new Error("custom_period comparison requires compareTo.customPeriod");
  }
  if (request.reportName === "cash_flow" && request.cashFlow === undefined) {
    throw new Error("cash_flow presentation requires cashFlow account classification options");
  }
}

export function buildStandardReportPresentation(request: StandardReportPresentationRequest): StandardReportPresentation {
  assertStandardReportControlsSupported(request);

  const requestedAccountingMethod = request.accountingMethod ?? request.reportInput.accountingBasis;
  assertStandardReportAccountingMethod(requestedAccountingMethod);
  const accountingMethod = requestedAccountingMethod;
  const reportInput = {
    ...request.reportInput,
    accountingBasis: accountingMethod
  };
  const primaryReport = buildReport(request.reportName, reportInput, request.cashFlow);
  const displayColumnsBy = request.displayColumnsBy ?? "none";
  const amountSpecs = amountColumnSpecs(request, reportInput, displayColumnsBy);
  const amountReports = new Map<string, BuiltReport>(
    amountSpecs.map((spec) => [spec.column.columnId, buildReport(request.reportName, spec.reportInput, request.cashFlow)])
  );
  const amountColumns = amountSpecs.map((spec) => spec.column);
  const calculationColumns = calculationColumnSpecs(request, reportInput, amountColumns);
  const rows = presentationRows(primaryReport, amountReports, amountColumns, calculationColumns);
  const comparisonReports = Object.fromEntries(
    [...amountReports.entries()]
      .filter(([columnId]) => columnId.startsWith("comparison:"))
      .map(([columnId, report]) => [columnId, report])
  );

  return {
    reportName: request.reportName,
    accountingMethod,
    displayColumnsBy,
    columns: [...amountColumns, ...calculationColumns],
    rows,
    primaryReport,
    comparisonReports
  };
}

function assertDisplayColumnsBySupported(value: StandardReportDisplayColumnsBy): void {
  if (!STANDARD_REPORT_DISPLAY_COLUMNS_BY_OPTIONS.some((option) => option.value === value)) {
    throw new Error(`Standard report display-columns option is not supported: ${value}`);
  }
}

function assertCompareToPeriodSupported(value: StandardReportCompareToPeriod): void {
  if (!STANDARD_REPORT_COMPARE_TO_PERIOD_OPTIONS.some((option) => option.value === value)) {
    throw new Error(`Standard report compare-to option is not supported: ${value}`);
  }
}

function assertComparisonCalculationSupported(value: StandardReportComparisonCalculation): void {
  if (!STANDARD_REPORT_COMPARISON_CALCULATION_OPTIONS.some((option) => option.value === value)) {
    throw new Error(`Standard report comparison calculation is not supported: ${value}`);
  }
}

function buildReport(
  reportName: ReportName,
  input: ReportBuilderInput,
  cashFlow: StandardReportPresentationRequest["cashFlow"]
): BuiltReport {
  switch (reportName) {
    case "profit_and_loss":
      return buildProfitAndLossReport(input);
    case "balance_sheet":
      return buildBalanceSheetReport(input);
    case "trial_balance":
      return buildTrialBalanceReport(input);
    case "cash_flow":
      return buildCashFlowReport({
        ...input,
        cashAccountIds: cashFlow?.cashAccountIds ?? [],
        activityByAccountId: cashFlow?.activityByAccountId ?? {}
      });
  }
}

function amountColumnSpecs(
  request: StandardReportPresentationRequest,
  reportInput: ReportBuilderInput,
  displayColumnsBy: StandardReportDisplayColumnsBy
): readonly AmountColumnBuildSpec[] {
  const baseSpecs = displayColumnGroups(request, reportInput, displayColumnsBy).map((group): AmountColumnBuildSpec => {
    const columnInput = {
      ...reportInput,
      periodStart: group.periodStart ?? reportInput.periodStart,
      periodEnd: group.periodEnd ?? reportInput.periodEnd,
      asOfDate: group.asOfDate ?? group.periodEnd ?? reportInput.asOfDate ?? reportInput.periodEnd,
      ...(group.postings === undefined ? {} : { postings: group.postings })
    };

    return {
      column: {
        columnId: `actual:${displayColumnsBy}:${group.key}`,
        label: group.label,
        kind: "actual",
        periodStart: columnInput.periodStart,
        periodEnd: columnInput.periodEnd,
        asOfDate: columnInput.asOfDate,
        displayColumnsBy,
        groupKey: group.key
      },
      reportInput: columnInput
    };
  });

  const comparisonSpecs = (request.compareTo?.periods ?? []).map((period): AmountColumnBuildSpec => {
    const comparisonPeriod = resolveComparisonPeriod(period, reportInput, request);
    return {
      column: {
        columnId: `comparison:${period}`,
        label: compareToLabel(period),
        kind: "comparison",
        periodStart: comparisonPeriod.periodStart,
        periodEnd: comparisonPeriod.periodEnd,
        asOfDate: comparisonPeriod.asOfDate,
        displayColumnsBy: "none",
        compareTo: period
      },
      reportInput: {
        ...reportInput,
        periodStart: comparisonPeriod.periodStart,
        periodEnd: comparisonPeriod.periodEnd,
        asOfDate: comparisonPeriod.asOfDate
      }
    };
  });

  return [...baseSpecs, ...comparisonSpecs];
}

function displayColumnGroups(
  request: StandardReportPresentationRequest,
  input: ReportBuilderInput,
  displayColumnsBy: StandardReportDisplayColumnsBy
): readonly DisplayColumnGroup[] {
  switch (displayColumnsBy) {
    case "none":
      return [
        {
          key: "total",
          label: "Total",
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          asOfDate: input.asOfDate ?? input.periodEnd
        }
      ];
    case "customer":
    case "employee":
    case "vendor":
      return partyGroups(input, request.parties ?? [], displayColumnsBy);
    case "product_service":
      return itemGroups(input, request.items ?? []);
    case "days":
      return dateGroups(input, "day", request);
    case "weeks":
      return dateGroups(input, "week", request);
    case "months":
      return dateGroups(input, "month", request);
    case "quarters":
      return dateGroups(input, "quarter", request);
    case "years":
      return dateGroups(input, "year", request);
  }
}

function partyGroups(
  input: ReportBuilderInput,
  parties: readonly Party[],
  displayColumnsBy: "customer" | "employee" | "vendor"
): readonly DisplayColumnGroup[] {
  const partyType = displayColumnsBy;
  const partyById = new Map(parties.filter((party) => party.partyType === partyType).map((party) => [party.partyId, party]));
  const groupKeys = uniqueStrings(
    input.postings
      .map((posting) => posting.partyId)
      .filter((partyId): partyId is string => partyId !== undefined && partyById.has(partyId))
  );

  return groupKeys
    .map((partyId) => ({
      key: partyId,
      label: partyById.get(partyId)?.displayName ?? partyId,
      postings: input.postings.filter((posting) => posting.partyId === partyId)
    }))
    .sort(compareDisplayGroups);
}

function itemGroups(input: ReportBuilderInput, items: readonly Item[]): readonly DisplayColumnGroup[] {
  const itemById = new Map(items.map((item) => [item.itemId, item]));
  const groupKeys = uniqueStrings(
    input.postings
      .map((posting) => posting.itemId)
      .filter((itemId): itemId is string => itemId !== undefined && itemById.has(itemId))
  );

  return groupKeys
    .map((itemId) => ({
      key: itemId,
      label: itemById.get(itemId)?.name ?? itemId,
      postings: input.postings.filter((posting) => posting.itemId === itemId)
    }))
    .sort(compareDisplayGroups);
}

function compareDisplayGroups(left: DisplayColumnGroup, right: DisplayColumnGroup): number {
  return left.label.localeCompare(right.label, "en", { sensitivity: "base" }) || left.key.localeCompare(right.key);
}

function dateGroups(
  input: ReportBuilderInput,
  grain: "day" | "week" | "month" | "quarter" | "year",
  request: StandardReportPresentationRequest
): readonly DisplayColumnGroup[] {
  const groups: DisplayColumnGroup[] = [];
  let cursor = parseIsoDate(input.periodStart);
  const end = parseIsoDate(input.periodEnd);

  while (cursor.getTime() <= end.getTime()) {
    const start = cursor;
    const periodEnd = minDate(end, endOfGrain(start, grain, request));
    const periodStart = formatIsoDate(start);
    const groupPeriodEnd = formatIsoDate(periodEnd);
    groups.push({
      key: `${grain}:${periodStart}:${groupPeriodEnd}`,
      label: dateGroupLabel(start, periodEnd, grain),
      periodStart,
      periodEnd: groupPeriodEnd,
      asOfDate: groupPeriodEnd
    });
    cursor = addDays(periodEnd, 1);
  }

  return groups;
}

function calculationColumnSpecs(
  request: StandardReportPresentationRequest,
  reportInput: ReportBuilderInput,
  amountColumns: readonly StandardReportPresentationColumn[]
): readonly StandardReportPresentationColumn[] {
  return (request.compareTo?.calculations ?? []).map((calculation) => ({
    columnId: `calculation:${calculation}`,
    label: calculationLabel(calculation),
    kind: "calculation",
    periodStart: reportInput.periodStart,
    periodEnd: reportInput.periodEnd,
    asOfDate: reportInput.asOfDate ?? reportInput.periodEnd,
    displayColumnsBy: "none",
    calculation,
    groupKey: amountColumns.map((column) => column.columnId).join(",")
  }));
}

function presentationRows(
  primaryReport: BuiltReport,
  amountReports: ReadonlyMap<string, BuiltReport>,
  amountColumns: readonly StandardReportPresentationColumn[],
  calculationColumns: readonly StandardReportPresentationColumn[]
): readonly StandardReportPresentationRow[] {
  const rowSeeds = rowSeedsFromReport(primaryReport);
  const lineAmounts = new Map([...amountReports.entries()].map(([columnId, report]) => [columnId, reportLineAmounts(report)]));
  const totalAmounts = new Map([...amountReports.entries()].map(([columnId, report]) => [columnId, reportTotalAmounts(report)]));

  return rowSeeds.map((row) => {
    const amountCells = amountColumns.map((column) => ({
      columnId: column.columnId,
      amount: amountForRow(row, lineAmounts.get(column.columnId) ?? new Map(), totalAmounts.get(column.columnId) ?? new Map())
    }));
    const calculationCells = calculationColumns.map((column) => ({
      columnId: column.columnId,
      percent: percentForCalculation(column.calculation ?? "percent_of_row", row, amountCells, primaryReport)
    }));

    return {
      ...row,
      cells: [...amountCells, ...calculationCells]
    };
  });
}

function rowSeedsFromReport(report: BuiltReport): readonly RowSeed[] {
  return [
    ...report.lines.map((line): RowSeed => ({
      rowId: rowIdForLine(line.accountId, line.reportLineId),
      kind: "line",
      label: line.label,
      section: line.section
    })),
    ...report.totals.map((total): RowSeed => ({
      rowId: rowIdForTotal(total.totalKey),
      kind: "total",
      label: total.label,
      totalKey: total.totalKey
    }))
  ];
}

function reportLineAmounts(report: BuiltReport): ReadonlyMap<string, DecimalString> {
  return new Map(report.lines.map((line) => [rowIdForLine(line.accountId, line.reportLineId), line.amount]));
}

function reportTotalAmounts(report: BuiltReport): ReadonlyMap<string, DecimalString> {
  return new Map(report.totals.map((total) => [rowIdForTotal(total.totalKey), total.amount]));
}

function amountForRow(
  row: RowSeed,
  lineAmounts: ReadonlyMap<string, DecimalString>,
  totalAmounts: ReadonlyMap<string, DecimalString>
): DecimalString {
  return row.kind === "line" ? lineAmounts.get(row.rowId) ?? ZERO : totalAmounts.get(row.rowId) ?? ZERO;
}

function percentForCalculation(
  calculation: StandardReportComparisonCalculation,
  row: RowSeed,
  cells: readonly { readonly amount?: DecimalString }[],
  primaryReport: BuiltReport
): DecimalString {
  const rowAmount = parseMoney(cells[0]?.amount ?? ZERO);
  const denominator =
    calculation === "percent_of_row"
      ? cells.reduce((sum, cell) => sum + absoluteMoney(cell.amount ?? ZERO), 0n)
      : calculation === "percent_of_column"
        ? primaryReport.totals.reduce((sum, total) => sum + absoluteMoney(total.amount), 0n)
        : calculation === "percent_of_income"
          ? amountForTotal(primaryReport, "total_income")
          : amountForTotal(primaryReport, "total_expenses");

  if (denominator === 0n) {
    return ZERO;
  }

  const percent = (rowAmount * ONE_HUNDRED) / denominator;
  return formatMoney(percent);
}

function amountForTotal(report: BuiltReport, totalKey: string): bigint {
  const total = report.totals.find((entry) => entry.totalKey === totalKey);
  return total === undefined ? 0n : parseMoney(total.amount);
}

function resolveComparisonPeriod(
  period: StandardReportCompareToPeriod,
  input: ReportBuilderInput,
  request: StandardReportPresentationRequest
): { readonly periodStart: IsoDate; readonly periodEnd: IsoDate; readonly asOfDate: IsoDate } {
  const start = parseIsoDate(input.periodStart);
  const end = parseIsoDate(input.periodEnd);
  const asOf = parseIsoDate(input.asOfDate ?? input.periodEnd);
  const daySpan = daysBetween(start, end) + 1;

  switch (period) {
    case "previous_year":
      return {
        periodStart: formatIsoDate(addYears(start, -1)),
        periodEnd: formatIsoDate(addYears(end, -1)),
        asOfDate: formatIsoDate(addYears(asOf, -1))
      };
    case "previous_period": {
      const periodEnd = addDays(start, -1);
      const periodStart = addDays(periodEnd, -daySpan + 1);
      return {
        periodStart: formatIsoDate(periodStart),
        periodEnd: formatIsoDate(periodEnd),
        asOfDate: formatIsoDate(periodEnd)
      };
    }
    case "year_to_date": {
      const periodStart = fiscalYearStart(end, request.fiscalYearStartMonth);
      return {
        periodStart: formatIsoDate(periodStart),
        periodEnd: input.periodEnd,
        asOfDate: input.asOfDate ?? input.periodEnd
      };
    }
    case "previous_year_to_date": {
      const currentFiscalYearStart = fiscalYearStart(end, request.fiscalYearStartMonth);
      return {
        periodStart: formatIsoDate(addYears(currentFiscalYearStart, -1)),
        periodEnd: formatIsoDate(addYears(end, -1)),
        asOfDate: formatIsoDate(addYears(asOf, -1))
      };
    }
    case "custom_period": {
      const customPeriod = request.compareTo?.customPeriod;
      if (customPeriod === undefined) {
        throw new Error("custom_period comparison requires compareTo.customPeriod");
      }
      return {
        periodStart: customPeriod.periodStart,
        periodEnd: customPeriod.periodEnd,
        asOfDate: customPeriod.asOfDate ?? customPeriod.periodEnd
      };
    }
  }
}

function compareToLabel(period: StandardReportCompareToPeriod): string {
  return STANDARD_REPORT_COMPARE_TO_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? period;
}

function calculationLabel(calculation: StandardReportComparisonCalculation): string {
  return STANDARD_REPORT_COMPARISON_CALCULATION_OPTIONS.find((option) => option.value === calculation)?.label ?? calculation;
}

function rowIdForLine(accountId: string | undefined, reportLineId: string): string {
  return accountId === undefined ? `line:${reportLineId}` : `line:account:${accountId}`;
}

function rowIdForTotal(totalKey: string): string {
  return `total:${totalKey}`;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function parseIsoDate(value: IsoDate): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function endOfGrain(
  date: Date,
  grain: "day" | "week" | "month" | "quarter" | "year",
  request: StandardReportPresentationRequest
): Date {
  switch (grain) {
    case "day":
      return date;
    case "week": {
      const weekStartsOn = request.weekStartsOn ?? 0;
      const dayOffset = (date.getUTCDay() - weekStartsOn + 7) % 7;
      return addDays(date, 6 - dayOffset);
    }
    case "month":
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    case "quarter": {
      const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
      return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth + 3, 0));
    }
    case "year":
      return new Date(Date.UTC(date.getUTCFullYear(), MONTHS_PER_YEAR, 0));
  }
}

function dateGroupLabel(start: Date, end: Date, grain: "day" | "week" | "month" | "quarter" | "year"): string {
  if (grain === "day") {
    return formatIsoDate(start);
  }
  if (grain === "month") {
    return `${String(start.getUTCMonth() + 1).padStart(2, "0")}/${String(start.getUTCFullYear())}`;
  }
  if (grain === "quarter") {
    return `Q${String(Math.floor(start.getUTCMonth() / 3) + 1)} ${String(start.getUTCFullYear())}`;
  }
  if (grain === "year") {
    return String(start.getUTCFullYear());
  }
  return `${formatIsoDate(start)} - ${formatIsoDate(end)}`;
}

function fiscalYearStart(date: Date, fiscalYearStartMonth = 1): Date {
  if (!Number.isInteger(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > MONTHS_PER_YEAR) {
    throw new Error(`fiscalYearStartMonth must be an integer from 1 to 12: ${String(fiscalYearStartMonth)}`);
  }

  const startMonthIndex = fiscalYearStartMonth - 1;
  const year = date.getUTCMonth() < startMonthIndex ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
  return new Date(Date.UTC(year, startMonthIndex, 1));
}

function absoluteMoney(value: DecimalString): bigint {
  const amount = parseMoney(value);
  return amount < 0n ? -amount : amount;
}

function parseMoney(value: DecimalString): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[2] === undefined) {
    throw new Error(`Decimal value must have at most two fractional digits: ${value}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100n + fraction);
}

function formatMoney(value: bigint): DecimalString {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}
