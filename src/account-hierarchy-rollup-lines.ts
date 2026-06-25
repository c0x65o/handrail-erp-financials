import { assertValidAccountHierarchy } from "./account-hierarchy.js";
import { createCompactDrilldownRef } from "./canonical-model.js";

import type {
  Account,
  AccountId,
  DecimalString,
  DrilldownQueryRef,
  LedgerPostingId,
  ReportLineId,
  ReportSnapshotId,
  ReportSnapshotLine,
  SafeSourcePayloadRef,
  SourceId,
  TenantId
} from "./canonical-model.js";

export type AccountHierarchyRollupLineAmount = {
  readonly accountId: AccountId;
  readonly amount: DecimalString;
  readonly section?: string;
  readonly postingIds?: readonly LedgerPostingId[];
  readonly sourceRefs?: readonly SafeSourcePayloadRef[];
};

export type AccountHierarchyRollupLineDrilldownQuery = Omit<
  DrilldownQueryRef,
  "kind" | "tenantId" | "accountIds"
>;

export type BuildAccountHierarchyRollupLinesInput = {
  readonly tenantId: TenantId;
  readonly sourceId?: SourceId;
  readonly reportSnapshotId: ReportSnapshotId;
  readonly reportName: string;
  readonly accounts: readonly Account[];
  readonly accountAmounts: readonly AccountHierarchyRollupLineAmount[];
  readonly drilldownQuery?: AccountHierarchyRollupLineDrilldownQuery;
  readonly includeZeroAmountAccounts?: boolean;
  readonly sortOrderStart?: number;
  readonly sortOrderStep?: number;
  readonly sectionOrder?: readonly string[];
  readonly labelForAccount?: (account: Account) => string;
  readonly sectionForAccount?: (
    account: Account,
    directAmount: AccountHierarchyRollupLineAmount | undefined
  ) => string;
};

const DEFAULT_SECTION_ORDER: readonly string[] = [
  "income",
  "cost_of_goods_sold",
  "expense",
  "other_income",
  "other_expense",
  "asset",
  "liability",
  "equity",
  "debit",
  "credit"
];

const ZERO = "0.00";

type AccountRollupNode = {
  readonly account: Account;
  readonly children: AccountRollupNode[];
};

type AccountRollup = {
  readonly amountMinor: bigint;
  readonly postingIds: readonly LedgerPostingId[];
  readonly sourceRefs: readonly SafeSourcePayloadRef[];
  readonly accountIds: readonly AccountId[];
  readonly visible: boolean;
};

/**
 * Builds stable nested account report lines from canonical account hierarchy
 * edges and direct account-level amounts. Each emitted account line includes
 * direct postings plus descendant postings exactly once for that account's
 * subtree.
 */
export function buildAccountHierarchyRollupLines(
  input: BuildAccountHierarchyRollupLinesInput
): readonly ReportSnapshotLine[] {
  const scopedAccounts = scopedAccountsForInput(input);
  assertValidAccountHierarchy(input.accounts, { accountsToValidate: scopedAccounts });

  const amountByAccountId = accountAmountMap(input.accountAmounts);
  const nodeByAccountId = accountNodeMap(scopedAccounts);

  for (const accountId of amountByAccountId.keys()) {
    if (!nodeByAccountId.has(accountId)) {
      throw new Error(`Account hierarchy rollup amount references missing account ${accountId}`);
    }
  }

  const roots = accountHierarchyRoots(nodeByAccountId, amountByAccountId, input);
  const rollups = new Map<AccountId, AccountRollup>();
  for (const root of roots) {
    buildRollup(root, amountByAccountId, rollups, input);
  }

  const lines: ReportSnapshotLine[] = [];
  collectRollupLines(roots, amountByAccountId, rollups, input, lines);

  return lines.map((line, index) => ({
    ...line,
    sortOrder: (input.sortOrderStart ?? 10) + index * (input.sortOrderStep ?? 10)
  }));
}

function scopedAccountsForInput(input: BuildAccountHierarchyRollupLinesInput): Account[] {
  const accounts = input.accounts.filter(
    (account) => account.tenantId === input.tenantId && (input.sourceId === undefined || account.sourceId === input.sourceId)
  );
  const seen = new Set<AccountId>();

  for (const account of accounts) {
    if (seen.has(account.accountId)) {
      throw new Error(`Account hierarchy rollup input has duplicate account ${account.accountId}`);
    }
    seen.add(account.accountId);
  }

  return accounts;
}

function accountAmountMap(
  accountAmounts: readonly AccountHierarchyRollupLineAmount[]
): ReadonlyMap<AccountId, AccountHierarchyRollupLineAmount> {
  const byAccountId = new Map<AccountId, AccountHierarchyRollupLineAmount>();

  for (const amount of accountAmounts) {
    if (byAccountId.has(amount.accountId)) {
      throw new Error(`Account hierarchy rollup input has duplicate amount for account ${amount.accountId}`);
    }
    byAccountId.set(amount.accountId, amount);
  }

  return byAccountId;
}

function accountNodeMap(accounts: readonly Account[]): Map<AccountId, AccountRollupNode> {
  return new Map(accounts.map((account) => [account.accountId, { account, children: [] }]));
}

function accountHierarchyRoots(
  nodeByAccountId: ReadonlyMap<AccountId, AccountRollupNode>,
  amountByAccountId: ReadonlyMap<AccountId, AccountHierarchyRollupLineAmount>,
  input: BuildAccountHierarchyRollupLinesInput
): AccountRollupNode[] {
  const roots: AccountRollupNode[] = [];

  for (const node of nodeByAccountId.values()) {
    const parentNode = node.account.parentAccountId === undefined ? undefined : nodeByAccountId.get(node.account.parentAccountId);

    if (parentNode === undefined) {
      roots.push(node);
    } else {
      parentNode.children.push(node);
    }
  }

  for (const node of nodeByAccountId.values()) {
    node.children.sort((left, right) => compareAccountNodes(left, right, amountByAccountId, input));
  }

  return roots.sort((left, right) => compareAccountNodes(left, right, amountByAccountId, input));
}

function buildRollup(
  node: AccountRollupNode,
  amountByAccountId: ReadonlyMap<AccountId, AccountHierarchyRollupLineAmount>,
  rollups: Map<AccountId, AccountRollup>,
  input: BuildAccountHierarchyRollupLinesInput
): AccountRollup {
  const directAmount = amountByAccountId.get(node.account.accountId);
  const childRollups = node.children.map((child) => buildRollup(child, amountByAccountId, rollups, input));
  const amountMinor =
    parseMoney(directAmount?.amount ?? ZERO) + childRollups.reduce((sum, childRollup) => sum + childRollup.amountMinor, 0n);
  const postingIds = uniqueStrings([
    ...(directAmount?.postingIds ?? []),
    ...childRollups.flatMap((childRollup) => childRollup.postingIds)
  ]);
  const sourceRefs = [
    ...(directAmount?.sourceRefs ?? []),
    ...childRollups.flatMap((childRollup) => childRollup.sourceRefs)
  ];
  const visible =
    input.includeZeroAmountAccounts === true ||
    amountMinor !== 0n ||
    (directAmount?.postingIds?.length ?? 0) > 0 ||
    (directAmount?.sourceRefs?.length ?? 0) > 0 ||
    childRollups.some((childRollup) => childRollup.visible);
  const accountIds = uniqueStrings([
    node.account.accountId,
    ...childRollups.filter((childRollup) => childRollup.visible).flatMap((childRollup) => childRollup.accountIds)
  ]);
  const rollup = {
    amountMinor,
    postingIds,
    sourceRefs,
    accountIds,
    visible
  };

  rollups.set(node.account.accountId, rollup);
  return rollup;
}

function collectRollupLines(
  nodes: readonly AccountRollupNode[],
  amountByAccountId: ReadonlyMap<AccountId, AccountHierarchyRollupLineAmount>,
  rollups: ReadonlyMap<AccountId, AccountRollup>,
  input: BuildAccountHierarchyRollupLinesInput,
  lines: ReportSnapshotLine[],
  parentReportLineId?: ReportLineId
): void {
  for (const node of nodes) {
    const rollup = requiredRollup(rollups, node.account.accountId);
    if (!rollup.visible) {
      continue;
    }

    const reportLineId = reportLineIdForAccount(input.reportName, node.account.accountId);
    lines.push({
      tenantId: input.tenantId,
      reportSnapshotId: input.reportSnapshotId,
      ...(parentReportLineId === undefined ? {} : { parentReportLineId }),
      reportLineId,
      section: sectionForAccount(input, node.account, amountByAccountId.get(node.account.accountId)),
      label: labelForAccount(input, node.account),
      accountId: node.account.accountId,
      amount: formatMoney(rollup.amountMinor),
      sortOrder: 0,
      drilldownRef: createCompactDrilldownRef({
        token: `${input.reportName}:${node.account.accountId}`,
        postingIds: rollup.postingIds,
        accountIds: rollup.accountIds,
        query: {
          kind: "ledger_postings",
          tenantId: input.tenantId,
          ...input.drilldownQuery,
          accountIds: rollup.accountIds
        },
        sourceRefs: rollup.sourceRefs
      })
    });

    collectRollupLines(node.children, amountByAccountId, rollups, input, lines, reportLineId);
  }
}

function requiredRollup(rollups: ReadonlyMap<AccountId, AccountRollup>, accountId: AccountId): AccountRollup {
  const rollup = rollups.get(accountId);
  if (rollup === undefined) {
    throw new Error(`Account hierarchy rollup was not built for account ${accountId}`);
  }
  return rollup;
}

function sectionForAccount(
  input: BuildAccountHierarchyRollupLinesInput,
  account: Account,
  directAmount: AccountHierarchyRollupLineAmount | undefined
): string {
  return input.sectionForAccount?.(account, directAmount) ?? directAmount?.section ?? account.classification;
}

function labelForAccount(input: BuildAccountHierarchyRollupLinesInput, account: Account): string {
  return input.labelForAccount?.(account) ?? (account.accountNumber === undefined ? account.name : `${account.accountNumber} ${account.name}`);
}

function reportLineIdForAccount(reportName: string, accountId: AccountId): ReportLineId {
  return `${reportName}:line:account:${accountId}`;
}

function compareAccountNodes(
  left: AccountRollupNode,
  right: AccountRollupNode,
  amountByAccountId: ReadonlyMap<AccountId, AccountHierarchyRollupLineAmount>,
  input: BuildAccountHierarchyRollupLinesInput
): number {
  return (
    compareSections(
      sectionForAccount(input, left.account, amountByAccountId.get(left.account.accountId)),
      sectionForAccount(input, right.account, amountByAccountId.get(right.account.accountId)),
      input.sectionOrder ?? DEFAULT_SECTION_ORDER
    ) ||
    compareOptionalAccountNumbers(left.account.accountNumber, right.account.accountNumber) ||
    left.account.name.localeCompare(right.account.name) ||
    left.account.accountId.localeCompare(right.account.accountId)
  );
}

function compareOptionalAccountNumbers(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined) {
    return 1;
  }

  if (right === undefined) {
    return -1;
  }

  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }) || left.localeCompare(right);
}

function compareSections(left: string, right: string, sectionOrder: readonly string[]): number {
  const leftIndex = sectionOrder.indexOf(left);
  const rightIndex = sectionOrder.indexOf(right);

  if (leftIndex >= 0 || rightIndex >= 0) {
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  }

  return left.localeCompare(right);
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

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}
