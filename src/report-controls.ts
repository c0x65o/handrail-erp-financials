import {
  buildBalanceSheetReport,
  buildCashFlowReport,
  buildIndirectCashFlowReport,
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
import type {
  BuiltReport,
  CashFlowBuilderInput,
  CashFlowMethod,
  ReportBuilderInput,
  ReportName
} from "./report-builders.js";

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
  readonly cashFlow?: Pick<CashFlowBuilderInput, "cashAccountIds" | "activityByAccountId"> & {
    readonly method?: CashFlowMethod;
  };
  readonly accountingMethod?: StandardReportAccountingMethod;
  readonly displayColumnsBy?: StandardReportDisplayColumnsBy;
  readonly compareTo?: StandardReportCompareToRequest;
  readonly parties?: readonly Party[];
  readonly items?: readonly Item[];
  readonly fiscalYearStartMonth?: number;
  readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
};

export type StandardReportPresentationReadModelRequest = Omit<StandardReportPresentationRequest, "reportInput" | "parties" | "items"> & {
  readonly tenantId: string;
  readonly companyId: string;
  readonly sourceId: string;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly asOfDate?: IsoDate;
  readonly currencyCode: string;
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
  readonly parentRowId?: string;
  readonly hierarchyDepth?: number;
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

export type StandardReportPresentationReportColumn = {
  readonly column: StandardReportPresentationColumn;
  readonly report: BuiltReport;
};

export type StandardReportPresentationReportSet = {
  readonly reportName: ReportName;
  readonly accountingMethod: StandardReportAccountingMethod;
  readonly displayColumnsBy: StandardReportDisplayColumnsBy;
  readonly primaryReport: BuiltReport;
  readonly amountColumns: readonly StandardReportPresentationReportColumn[];
  readonly calculationColumns?: readonly StandardReportPresentationColumn[];
};

export type StandardReportPresentationReadModelStorage = {
  loadStandardReportPresentation(request: StandardReportPresentationReadModelRequest): Promise<StandardReportPresentationReportSet>;
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
  readonly parentRowId?: string;
  readonly hierarchyDepth?: number;
  readonly section?: string;
  readonly totalKey?: string;
};

type OrderedReportLine = {
  readonly line: BuiltReport["lines"][number];
  readonly rootSection: string;
};

type LineRowSeedEntry = {
  readonly seed: RowSeed;
  readonly rootSection: string;
  readonly sortOrder: number;
  readonly accountId?: string;
  readonly sourceRank: number;
};

type ReportRowSeedEntries = {
  readonly lineSeeds: readonly LineRowSeedEntry[];
  readonly totalSeeds: readonly RowSeed[];
};

type StatementRowOrderEntry = {
  readonly section?: string;
  readonly totalKeys?: readonly string[];
};

const ZERO = "0.00";
const ONE_HUNDRED = 10000n;
const MONTHS_PER_YEAR = 12;

const LINE_SECTION_ORDER_BY_REPORT_NAME: Readonly<Record<ReportName, readonly string[]>> = {
  profit_and_loss: ["income", "cost_of_goods_sold", "expense", "other_income", "other_expense"],
  balance_sheet: ["asset", "liability", "equity"],
  trial_balance: ["debit", "credit"],
  cash_flow: ["operating", "investing", "financing", "unclassified"]
};

const STATEMENT_ROW_ORDER_BY_REPORT_NAME: Readonly<Record<ReportName, readonly StatementRowOrderEntry[]>> = {
  profit_and_loss: [
    { section: "income" },
    { totalKeys: ["total_income"] },
    { section: "cost_of_goods_sold" },
    { totalKeys: ["total_cost_of_goods_sold", "gross_profit"] },
    { section: "expense" },
    { totalKeys: ["total_expenses", "net_operating_income"] },
    { section: "other_income" },
    { totalKeys: ["total_other_income"] },
    { section: "other_expense" },
    { totalKeys: ["total_other_expense", "net_income"] }
  ],
  balance_sheet: [
    { section: "asset" },
    { totalKeys: ["total_assets"] },
    { section: "liability" },
    { totalKeys: ["total_liabilities"] },
    { section: "equity" },
    { totalKeys: ["total_equity", "total_liabilities_and_equity"] }
  ],
  trial_balance: [
    { section: "debit" },
    { totalKeys: ["total_debits"] },
    { section: "credit" },
    { totalKeys: ["total_credits"] }
  ],
  cash_flow: [
    { totalKeys: ["cash_beginning"] },
    { section: "operating" },
    { totalKeys: ["net_operating_cash"] },
    { section: "investing" },
    { totalKeys: ["net_investing_cash"] },
    { section: "financing" },
    { totalKeys: ["net_financing_cash"] },
    { section: "unclassified" },
    { totalKeys: ["unclassified_cash_movement", "net_cash_flow", "cash_ending"] }
  ]
};

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

export async function buildStandardReportPresentationFromReadModel(
  storage: StandardReportPresentationReadModelStorage,
  request: StandardReportPresentationReadModelRequest
): Promise<StandardReportPresentation> {
  assertStandardReportAccountingMethod(request.accountingMethod ?? "accrual");
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

  return buildStandardReportPresentationFromReports(await storage.loadStandardReportPresentation(request));
}

export function buildStandardReportPresentationFromReports(reportSet: StandardReportPresentationReportSet): StandardReportPresentation {
  const amountReports = new Map<string, BuiltReport>(
    reportSet.amountColumns.map((entry) => [entry.column.columnId, entry.report])
  );
  const amountColumns = reportSet.amountColumns.map((entry) => entry.column);
  const calculationColumns = reportSet.calculationColumns ?? [];
  const comparisonReports = Object.fromEntries(
    [...amountReports.entries()]
      .filter(([columnId]) => columnId.startsWith("comparison:"))
      .map(([columnId, report]) => [columnId, report])
  );

  return {
    reportName: reportSet.reportName,
    accountingMethod: reportSet.accountingMethod,
    displayColumnsBy: reportSet.displayColumnsBy,
    columns: [...amountColumns, ...calculationColumns],
    rows: presentationRows(reportSet.primaryReport, amountReports, amountColumns, calculationColumns),
    primaryReport: reportSet.primaryReport,
    comparisonReports
  };
}

/**
 * Reference/fixture implementation for small canonical fact sets. Production
 * standard-report presentation should use buildStandardReportPresentationFromReadModel
 * so snapshots, rollups, or SQL aggregates do the heavy lifting before Node formats rows.
 */
export function buildReferenceStandardReportPresentationFromFacts(request: StandardReportPresentationRequest): StandardReportPresentation {
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

  return buildStandardReportPresentationFromReports({
    reportName: request.reportName,
    accountingMethod,
    displayColumnsBy,
    primaryReport,
    amountColumns: amountColumns.map((column) => ({
      column,
      report: amountReports.get(column.columnId) ?? primaryReport
    })),
    calculationColumns
  });
}

/**
 * @deprecated Use buildReferenceStandardReportPresentationFromFacts for fixture
 * and formula-reference coverage. Production presentation should use
 * buildStandardReportPresentationFromReadModel with snapshots, rollups, or SQL aggregates.
 */
export const buildStandardReportPresentationFromFacts = buildReferenceStandardReportPresentationFromFacts;

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
    case "cash_flow": {
      const cashFlowInput = {
        ...input,
        cashAccountIds: cashFlow?.cashAccountIds ?? [],
        activityByAccountId: cashFlow?.activityByAccountId ?? {}
      };
      return cashFlow?.method === "indirect"
        ? buildIndirectCashFlowReport(cashFlowInput)
        : buildCashFlowReport(cashFlowInput);
    }
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
  const rowSeeds = rowSeedsFromReports(primaryReport, amountReports);
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

function rowSeedsFromReports(primaryReport: BuiltReport, amountReports: ReadonlyMap<string, BuiltReport>): readonly RowSeed[] {
  const lineSeedEntriesByRowId = new Map<string, LineRowSeedEntry>();
  const totalSeedsByRowId = new Map<string, RowSeed>();

  [primaryReport, ...amountReports.values()].forEach((report, sourceRank) => {
    const entries = rowSeedEntriesFromReport(report, sourceRank);
    for (const entry of entries.lineSeeds) {
      lineSeedEntriesByRowId.set(
        entry.seed.rowId,
        mergeLineRowSeedEntry(lineSeedEntriesByRowId.get(entry.seed.rowId), entry)
      );
    }
    for (const seed of entries.totalSeeds) {
      if (!totalSeedsByRowId.has(seed.rowId)) {
        totalSeedsByRowId.set(seed.rowId, seed);
      }
    }
  });

  return orderRowSeeds(
    primaryReport.metadata.reportName,
    [...lineSeedEntriesByRowId.values()],
    [...totalSeedsByRowId.values()]
  );
}

function rowSeedEntriesFromReport(report: BuiltReport, sourceRank: number): ReportRowSeedEntries {
  const lineByReportLineId = new Map(report.lines.map((line) => [line.reportLineId, line]));
  const childParentReportLineIds = new Set(
    report.lines
      .map((line) => line.parentReportLineId)
      .filter((parentReportLineId): parentReportLineId is string => parentReportLineId !== undefined)
  );
  const hierarchyDepthByReportLineId = new Map<string, number>();
  const hierarchyDepthForLine = (reportLineId: string, visited = new Set<string>()): number => {
    const memoized = hierarchyDepthByReportLineId.get(reportLineId);
    if (memoized !== undefined) {
      return memoized;
    }
    const line = lineByReportLineId.get(reportLineId);
    if (line === undefined || line.parentReportLineId === undefined || visited.has(reportLineId)) {
      hierarchyDepthByReportLineId.set(reportLineId, 0);
      return 0;
    }

    visited.add(reportLineId);
    const depth = hierarchyDepthForLine(line.parentReportLineId, visited) + 1;
    hierarchyDepthByReportLineId.set(reportLineId, depth);
    return depth;
  };

  const lineSeeds = orderedReportLines(report).map(({ line, rootSection }) => {
    const parentLine =
      line.parentReportLineId === undefined ? undefined : lineByReportLineId.get(line.parentReportLineId);
    const participatesInHierarchy =
      line.parentReportLineId !== undefined || childParentReportLineIds.has(line.reportLineId);

    return {
      rootSection,
      seed: {
        rowId: rowIdForLine(line.accountId, line.reportLineId),
        kind: "line",
        label: line.label,
        ...(parentLine === undefined ? {} : { parentRowId: rowIdForLine(parentLine.accountId, parentLine.reportLineId) }),
        ...(participatesInHierarchy ? { hierarchyDepth: hierarchyDepthForLine(line.reportLineId) } : {}),
        section: line.section
      } satisfies RowSeed,
      sortOrder: line.sortOrder,
      ...(line.accountId === undefined ? {} : { accountId: line.accountId }),
      sourceRank
    };
  });
  const totalSeeds = report.totals.map((total): RowSeed => ({
    rowId: rowIdForTotal(total.totalKey),
    kind: "total",
    label: total.label,
    totalKey: total.totalKey
  }));

  return { lineSeeds, totalSeeds };
}

function mergeLineRowSeedEntry(
  existing: LineRowSeedEntry | undefined,
  candidate: LineRowSeedEntry
): LineRowSeedEntry {
  if (existing === undefined) {
    return candidate;
  }

  const preferred = candidate.sourceRank < existing.sourceRank ? candidate : existing;
  const fallback = preferred === candidate ? existing : candidate;

  return {
    ...preferred,
    seed: {
      ...preferred.seed,
      ...(preferred.seed.parentRowId === undefined && fallback.seed.parentRowId !== undefined
        ? { parentRowId: fallback.seed.parentRowId }
        : {}),
      ...(preferred.seed.hierarchyDepth === undefined && fallback.seed.hierarchyDepth !== undefined
        ? { hierarchyDepth: fallback.seed.hierarchyDepth }
        : {}),
      ...(preferred.seed.section === undefined && fallback.seed.section !== undefined ? { section: fallback.seed.section } : {})
    }
  };
}

function orderRowSeeds(
  reportName: ReportName,
  lineSeedEntries: readonly LineRowSeedEntry[],
  totalSeeds: readonly RowSeed[]
): readonly RowSeed[] {
  const lineSeeds = orderLineRowSeedEntries(reportName, lineSeedEntries);
  const totalSeedsByKey = new Map<string, RowSeed>();
  for (const seed of totalSeeds) {
    if (seed.totalKey !== undefined) {
      totalSeedsByKey.set(seed.totalKey, seed);
    }
  }
  const orderedSeeds: RowSeed[] = [];
  const emittedLineRowIds = new Set<string>();
  const emittedTotalKeys = new Set<string>();

  const emitLinesForSection = (section: string): void => {
    for (const { rootSection, seed } of lineSeeds) {
      if (rootSection === section && !emittedLineRowIds.has(seed.rowId)) {
        orderedSeeds.push(seed);
        emittedLineRowIds.add(seed.rowId);
      }
    }
  };
  const emitTotal = (totalKey: string): void => {
    const seed = totalSeedsByKey.get(totalKey);
    if (seed !== undefined && !emittedTotalKeys.has(totalKey)) {
      orderedSeeds.push(seed);
      emittedTotalKeys.add(totalKey);
    }
  };

  for (const entry of STATEMENT_ROW_ORDER_BY_REPORT_NAME[reportName]) {
    if (entry.section !== undefined) {
      emitLinesForSection(entry.section);
    }
    for (const totalKey of entry.totalKeys ?? []) {
      emitTotal(totalKey);
    }
  }

  for (const { seed } of lineSeeds) {
    if (!emittedLineRowIds.has(seed.rowId)) {
      orderedSeeds.push(seed);
      emittedLineRowIds.add(seed.rowId);
    }
  }
  for (const seed of [...totalSeeds].sort(compareTotalSeeds)) {
    if (seed.totalKey !== undefined && !emittedTotalKeys.has(seed.totalKey)) {
      orderedSeeds.push(seed);
      emittedTotalKeys.add(seed.totalKey);
    }
  }

  return orderedSeeds;
}

function orderLineRowSeedEntries(
  reportName: ReportName,
  entries: readonly LineRowSeedEntry[]
): readonly LineRowSeedEntry[] {
  const compareEntries = compareLineRowSeedEntries(reportName);
  const entryByRowId = new Map(entries.map((entry) => [entry.seed.rowId, entry]));
  const childrenByParentRowId = new Map<string, LineRowSeedEntry[]>();
  const roots: LineRowSeedEntry[] = [];

  for (const entry of entries) {
    if (entry.seed.parentRowId !== undefined && entryByRowId.has(entry.seed.parentRowId)) {
      const siblings = childrenByParentRowId.get(entry.seed.parentRowId) ?? [];
      siblings.push(entry);
      childrenByParentRowId.set(entry.seed.parentRowId, siblings);
    } else {
      roots.push(entry);
    }
  }

  for (const siblings of childrenByParentRowId.values()) {
    siblings.sort(compareEntries);
  }

  const orderedEntries: LineRowSeedEntry[] = [];
  const emittedRowIds = new Set<string>();
  const visitingRowIds = new Set<string>();
  const visit = (entry: LineRowSeedEntry, rootSection: string): void => {
    if (emittedRowIds.has(entry.seed.rowId) || visitingRowIds.has(entry.seed.rowId)) {
      return;
    }

    visitingRowIds.add(entry.seed.rowId);
    orderedEntries.push({ ...entry, rootSection });
    emittedRowIds.add(entry.seed.rowId);
    for (const child of childrenByParentRowId.get(entry.seed.rowId) ?? []) {
      visit(child, rootSection);
    }
    visitingRowIds.delete(entry.seed.rowId);
  };

  for (const root of [...roots].sort(compareEntries)) {
    visit(root, root.seed.section ?? root.rootSection);
  }
  for (const entry of [...entries].sort(compareEntries)) {
    if (!emittedRowIds.has(entry.seed.rowId)) {
      visit(entry, entry.seed.section ?? entry.rootSection);
    }
  }

  return orderedEntries;
}

function orderedReportLines(report: BuiltReport): readonly OrderedReportLine[] {
  const compareLines = compareReportLines(report.metadata.reportName);
  const lineByReportLineId = new Map(report.lines.map((line) => [line.reportLineId, line]));
  const childrenByParentReportLineId = new Map<string, BuiltReport["lines"][number][]>();
  const roots: BuiltReport["lines"][number][] = [];

  for (const line of report.lines) {
    if (line.parentReportLineId !== undefined && lineByReportLineId.has(line.parentReportLineId)) {
      const siblings = childrenByParentReportLineId.get(line.parentReportLineId) ?? [];
      siblings.push(line);
      childrenByParentReportLineId.set(line.parentReportLineId, siblings);
    } else {
      roots.push(line);
    }
  }

  for (const siblings of childrenByParentReportLineId.values()) {
    siblings.sort(compareLines);
  }

  const orderedLines: OrderedReportLine[] = [];
  const emittedLineIds = new Set<string>();
  const visitingLineIds = new Set<string>();
  const visit = (line: BuiltReport["lines"][number], rootSection: string): void => {
    if (emittedLineIds.has(line.reportLineId) || visitingLineIds.has(line.reportLineId)) {
      return;
    }

    visitingLineIds.add(line.reportLineId);
    orderedLines.push({ line, rootSection });
    emittedLineIds.add(line.reportLineId);
    for (const child of childrenByParentReportLineId.get(line.reportLineId) ?? []) {
      visit(child, rootSection);
    }
    visitingLineIds.delete(line.reportLineId);
  };

  for (const root of [...roots].sort(compareLines)) {
    visit(root, root.section);
  }
  for (const line of [...report.lines].sort(compareLines)) {
    if (!emittedLineIds.has(line.reportLineId)) {
      visit(line, line.section);
    }
  }

  return orderedLines;
}

function compareReportLines(reportName: ReportName): (left: BuiltReport["lines"][number], right: BuiltReport["lines"][number]) => number {
  const sectionOrder = LINE_SECTION_ORDER_BY_REPORT_NAME[reportName];
  return (left, right) =>
    compareNumbers(left.sortOrder, right.sortOrder) ||
    compareNumbers(sectionRank(sectionOrder, left.section), sectionRank(sectionOrder, right.section)) ||
    left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
    (left.accountId ?? "").localeCompare(right.accountId ?? "") ||
    rowIdForLine(left.accountId, left.reportLineId).localeCompare(rowIdForLine(right.accountId, right.reportLineId));
}

function compareLineRowSeedEntries(reportName: ReportName): (left: LineRowSeedEntry, right: LineRowSeedEntry) => number {
  const sectionOrder = LINE_SECTION_ORDER_BY_REPORT_NAME[reportName];
  return (left, right) =>
    compareNumbers(left.sortOrder, right.sortOrder) ||
    compareNumbers(sectionRank(sectionOrder, left.seed.section ?? ""), sectionRank(sectionOrder, right.seed.section ?? "")) ||
    left.seed.label.localeCompare(right.seed.label, "en", { sensitivity: "base" }) ||
    (left.accountId ?? "").localeCompare(right.accountId ?? "") ||
    left.seed.rowId.localeCompare(right.seed.rowId);
}

function compareTotalSeeds(left: RowSeed, right: RowSeed): number {
  return (
    (left.totalKey ?? "").localeCompare(right.totalKey ?? "") ||
    left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
    left.rowId.localeCompare(right.rowId)
  );
}

function sectionRank(sectionOrder: readonly string[], section: string): number {
  const index = sectionOrder.indexOf(section);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
