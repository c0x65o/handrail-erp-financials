import type { Account, AccountId, SourceId, TenantId } from "./canonical-model.js";

export type AccountHierarchyDiagnosticCode =
  | "account_parent_orphan"
  | "account_parent_cross_scope"
  | "account_parent_cycle";

export type AccountHierarchyDiagnostic = {
  readonly code: AccountHierarchyDiagnosticCode;
  readonly severity: "error";
  readonly tenantId: TenantId;
  readonly sourceId: SourceId;
  readonly accountId: AccountId;
  readonly parentAccountId?: AccountId;
  readonly parentTenantId?: TenantId;
  readonly parentSourceId?: SourceId;
  readonly cycleAccountIds?: readonly AccountId[];
  readonly message: string;
};

export type AccountHierarchyValidationOptions = {
  /**
   * All loaded accounts are used to resolve parent ids. When provided, only
   * these child accounts are validated and reported.
   */
  readonly accountsToValidate?: readonly Account[];
};

export class AccountHierarchyValidationError extends Error {
  readonly diagnostics: readonly AccountHierarchyDiagnostic[];

  constructor(diagnostics: readonly AccountHierarchyDiagnostic[]) {
    super(accountHierarchyValidationMessage(diagnostics));
    this.name = "AccountHierarchyValidationError";
    this.diagnostics = diagnostics;
    Object.setPrototypeOf(this, AccountHierarchyValidationError.prototype);
  }
}

export function validateAccountHierarchy(
  accounts: readonly Account[],
  options: AccountHierarchyValidationOptions = {}
): readonly AccountHierarchyDiagnostic[] {
  const accountsToValidate = options.accountsToValidate ?? accounts;
  const allAccounts = sortedAccounts(dedupeAccountsByScopeKey([...accounts, ...accountsToValidate]));
  const accountsById = accountsByAccountId(allAccounts);
  const accountsByScopeKey = new Map(allAccounts.map((account) => [accountScopeKey(account), account]));
  const validParentByChildKey = new Map<string, string>();
  const diagnostics: AccountHierarchyDiagnostic[] = [];

  for (const account of sortedAccounts(accountsToValidate)) {
    if (account.parentAccountId === undefined) {
      continue;
    }

    const parentCandidates = sortedAccounts(accountsById.get(account.parentAccountId) ?? []);
    const sameScopeParent = parentCandidates.find((parent) => hasSameTenantAndSource(account, parent));

    if (sameScopeParent === undefined) {
      const crossScopeParent = parentCandidates[0];
      diagnostics.push(
        crossScopeParent === undefined
          ? orphanDiagnostic(account)
          : crossScopeDiagnostic(account, crossScopeParent)
      );
      continue;
    }

    validParentByChildKey.set(accountScopeKey(account), accountScopeKey(sameScopeParent));
  }

  diagnostics.push(...cycleDiagnostics(accountsToValidate, accountsByScopeKey, validParentByChildKey));

  return diagnostics;
}

export function assertValidAccountHierarchy(
  accounts: readonly Account[],
  options: AccountHierarchyValidationOptions = {}
): void {
  const diagnostics = validateAccountHierarchy(accounts, options);

  if (diagnostics.length > 0) {
    throw new AccountHierarchyValidationError(diagnostics);
  }
}

function cycleDiagnostics(
  accountsToValidate: readonly Account[],
  accountsByScopeKey: ReadonlyMap<string, Account>,
  validParentByChildKey: ReadonlyMap<string, string>
): readonly AccountHierarchyDiagnostic[] {
  const diagnostics: AccountHierarchyDiagnostic[] = [];
  const stateByKey = new Map<string, "visiting" | "visited">();
  const emittedCycleSignatures = new Set<string>();

  const visit = (accountKey: string, stack: string[]): void => {
    const state = stateByKey.get(accountKey);

    if (state === "visiting") {
      const cycleStartIndex = stack.indexOf(accountKey);
      if (cycleStartIndex < 0) {
        return;
      }
      const cycleKeys = stack.slice(cycleStartIndex);
      const cycleSignature = [...cycleKeys].sort().join("\u0000");
      if (emittedCycleSignatures.has(cycleSignature)) {
        return;
      }
      emittedCycleSignatures.add(cycleSignature);
      diagnostics.push(cycleDiagnostic(cycleKeys, accountsByScopeKey));
      return;
    }

    if (state === "visited") {
      return;
    }

    stateByKey.set(accountKey, "visiting");
    stack.push(accountKey);

    const parentKey = validParentByChildKey.get(accountKey);
    if (parentKey !== undefined) {
      visit(parentKey, stack);
    }

    stack.pop();
    stateByKey.set(accountKey, "visited");
  };

  for (const account of sortedAccounts(accountsToValidate)) {
    visit(accountScopeKey(account), []);
  }

  return diagnostics;
}

function orphanDiagnostic(account: Account): AccountHierarchyDiagnostic {
  const parentAccountId = account.parentAccountId;
  if (parentAccountId === undefined) {
    throw new Error("orphan diagnostic requires parentAccountId");
  }

  return {
    code: "account_parent_orphan",
    severity: "error",
    tenantId: account.tenantId,
    sourceId: account.sourceId,
    accountId: account.accountId,
    parentAccountId,
    message: `Account ${account.accountId} references missing parent account ${parentAccountId} in tenant ${account.tenantId} source ${account.sourceId}`
  };
}

function crossScopeDiagnostic(account: Account, parent: Account): AccountHierarchyDiagnostic {
  const parentAccountId = account.parentAccountId;
  if (parentAccountId === undefined) {
    throw new Error("cross-scope diagnostic requires parentAccountId");
  }

  return {
    code: "account_parent_cross_scope",
    severity: "error",
    tenantId: account.tenantId,
    sourceId: account.sourceId,
    accountId: account.accountId,
    parentAccountId,
    parentTenantId: parent.tenantId,
    parentSourceId: parent.sourceId,
    message: `Account ${account.accountId} references parent account ${parentAccountId} outside tenant/source scope ${account.tenantId}/${account.sourceId}`
  };
}

function cycleDiagnostic(
  cycleKeys: readonly string[],
  accountsByScopeKey: ReadonlyMap<string, Account>
): AccountHierarchyDiagnostic {
  const cycleAccounts = cycleKeys.map((key) => accountsByScopeKey.get(key)).filter((account): account is Account => account !== undefined);
  const firstAccount = cycleAccounts[0];

  if (firstAccount === undefined || firstAccount.parentAccountId === undefined) {
    throw new Error("cycle diagnostic requires a parented account cycle");
  }

  const cycleAccountIds = cycleAccounts.map((account) => account.accountId);

  return {
    code: "account_parent_cycle",
    severity: "error",
    tenantId: firstAccount.tenantId,
    sourceId: firstAccount.sourceId,
    accountId: firstAccount.accountId,
    parentAccountId: firstAccount.parentAccountId,
    cycleAccountIds,
    message: `Account hierarchy contains a cycle in tenant ${firstAccount.tenantId} source ${firstAccount.sourceId}: ${[
      ...cycleAccountIds,
      cycleAccountIds[0]
    ].join(" -> ")}`
  };
}

function accountsByAccountId(accounts: readonly Account[]): ReadonlyMap<AccountId, readonly Account[]> {
  const byId = new Map<AccountId, Account[]>();

  for (const account of accounts) {
    const existing = byId.get(account.accountId);
    if (existing === undefined) {
      byId.set(account.accountId, [account]);
    } else {
      existing.push(account);
    }
  }

  for (const [accountId, candidates] of byId) {
    byId.set(accountId, sortedAccounts(candidates));
  }

  return byId;
}

function dedupeAccountsByScopeKey(accounts: readonly Account[]): readonly Account[] {
  const byKey = new Map<string, Account>();

  for (const account of accounts) {
    const key = accountScopeKey(account);
    if (!byKey.has(key)) {
      byKey.set(key, account);
    }
  }

  return [...byKey.values()];
}

function sortedAccounts(accounts: readonly Account[]): Account[] {
  return [...accounts].sort(compareAccounts);
}

function compareAccounts(left: Account, right: Account): number {
  return (
    left.tenantId.localeCompare(right.tenantId) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.accountId.localeCompare(right.accountId) ||
    (left.parentAccountId ?? "").localeCompare(right.parentAccountId ?? "")
  );
}

function hasSameTenantAndSource(left: Account, right: Account): boolean {
  return left.tenantId === right.tenantId && left.sourceId === right.sourceId;
}

function accountScopeKey(account: Account): string {
  return `${account.tenantId}\u0000${account.sourceId}\u0000${account.accountId}`;
}

function accountHierarchyValidationMessage(diagnostics: readonly AccountHierarchyDiagnostic[]): string {
  const summary = diagnostics
    .map((diagnostic) => `${diagnostic.code}:${diagnostic.accountId}`)
    .join(", ");

  return `Invalid account hierarchy: ${summary}`;
}
