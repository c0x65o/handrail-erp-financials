import { assertPostingRule } from "./transaction-matching.js";

import type {
  Account,
  AccountId,
  DecimalString,
  DimensionRef,
  IsoCurrencyCode,
  IsoDate,
  PartyId,
  SourceScopedRecord,
  TransactionId
} from "./canonical-model.js";
import type {
  PostingRule,
  PostingRuleAction,
  PostingRuleCondition,
  PostingRuleId
} from "./transaction-matching.js";

export type PostingRuleAccount = Pick<Account, "tenantId" | "sourceId" | "accountId" | "active">;

export type PostingRuleEvaluationInput = SourceScopedRecord & {
  readonly transactionId: TransactionId;
  readonly sourceTransactionType: string;
  readonly transactionDate: IsoDate;
  readonly transactionNumber?: string;
  readonly partyId?: PartyId;
  readonly currencyCode: IsoCurrencyCode;
  readonly memo?: string;
  /** Positive gross amount available to the posting rule. */
  readonly amount: DecimalString;
  /** Optional positive or zero amount not yet allocated by an earlier workflow. */
  readonly unappliedAmount?: DecimalString;
  readonly dimensionRefs?: readonly DimensionRef[];
  /** Canonical accounts available to this tenant/source for action validation. */
  readonly accounts: readonly PostingRuleAccount[];
  readonly rules: readonly PostingRule[];
};

export type PostingRuleProposalLine = {
  readonly sequence: number;
  readonly side: "debit" | "credit";
  readonly accountId: AccountId;
  readonly amount: DecimalString;
  readonly debitAmount: DecimalString;
  readonly creditAmount: DecimalString;
  readonly partyId?: PartyId;
  readonly dimensionRefs: readonly DimensionRef[];
  readonly description?: string;
};

export type PostingRulePostingProposal = {
  readonly postingRuleId: PostingRuleId;
  readonly ruleCode: string;
  readonly transactionId: TransactionId;
  readonly currencyCode: IsoCurrencyCode;
  readonly lines: readonly PostingRuleProposalLine[];
  readonly totalDebit: DecimalString;
  readonly totalCredit: DecimalString;
};

export type PostingRuleEvaluationIssueCode =
  | "ambiguous_top_priority"
  | "missing_transaction_party"
  | "missing_unapplied_amount"
  | "unknown_account"
  | "inactive_account"
  | "rounded_action_to_zero"
  | "unbalanced_rule_actions";

export type PostingRuleEvaluationIssue = {
  readonly code: PostingRuleEvaluationIssueCode;
  readonly message: string;
  readonly postingRuleIds: readonly PostingRuleId[];
};

export type PostingRuleEvaluationResult = {
  readonly status: "matched" | "no_match" | "ambiguous" | "invalid";
  readonly matchedPostingRuleIds: readonly PostingRuleId[];
  readonly selectedPostingRuleId?: PostingRuleId;
  readonly proposal?: PostingRulePostingProposal;
  readonly issues: readonly PostingRuleEvaluationIssue[];
};

/**
 * Evaluates one transaction against active rules. Lower numeric priority wins;
 * more than one match at the winning priority is returned as ambiguous and
 * never produces postings.
 */
export function evaluatePostingRules(input: PostingRuleEvaluationInput): PostingRuleEvaluationResult {
  assertEvaluationInput(input);
  const eligibleRules = input.rules
    .filter((rule) => {
      assertPostingRule(rule);
      return isEligibleRule(input, rule);
    })
    .sort(compareRules);
  const matches = eligibleRules.filter((rule) => ruleMatches(input, rule));
  const matchedPostingRuleIds = matches.map((rule) => rule.postingRuleId);

  if (matches.length === 0) {
    return {
      status: "no_match",
      matchedPostingRuleIds: [],
      issues: []
    };
  }

  const winningPriority = matches[0]?.priority;
  const winningRules = matches.filter((rule) => rule.priority === winningPriority);
  if (winningRules.length !== 1) {
    const postingRuleIds = winningRules.map((rule) => rule.postingRuleId);
    return {
      status: "ambiguous",
      matchedPostingRuleIds,
      issues: [
        {
          code: "ambiguous_top_priority",
          message: `multiple posting rules matched at priority ${String(winningPriority)}`,
          postingRuleIds
        }
      ]
    };
  }

  const rule = winningRules[0];
  if (rule === undefined) {
    throw new Error("posting rule evaluation could not resolve its winning rule");
  }
  const proposal = buildProposal(input, rule);
  if ("issue" in proposal) {
    return {
      status: "invalid",
      matchedPostingRuleIds,
      selectedPostingRuleId: rule.postingRuleId,
      issues: [proposal.issue]
    };
  }

  return {
    status: "matched",
    matchedPostingRuleIds,
    selectedPostingRuleId: rule.postingRuleId,
    proposal,
    issues: []
  };
}

function assertEvaluationInput(input: PostingRuleEvaluationInput): void {
  assertNonEmpty(input.tenantId, "posting rule evaluation tenantId");
  assertNonEmpty(input.sourceId, "posting rule evaluation sourceId");
  assertNonEmpty(input.transactionId, "posting rule evaluation transactionId");
  assertNonEmpty(input.sourceTransactionType, "posting rule evaluation sourceTransactionType");
  assertNonEmpty(input.currencyCode, "posting rule evaluation currencyCode");
  const amountMinor = parseMoney(input.amount, "posting rule evaluation amount");
  if (amountMinor <= 0n) {
    throw new Error("posting rule evaluation amount must be greater than 0");
  }
  if (input.unappliedAmount !== undefined) {
    const unappliedMinor = parseMoney(input.unappliedAmount, "posting rule evaluation unappliedAmount");
    if (unappliedMinor < 0n || unappliedMinor > amountMinor) {
      throw new Error("posting rule evaluation unappliedAmount must be between 0 and amount");
    }
  }
  const scopedAccountIds = new Set<AccountId>();
  for (const account of input.accounts) {
    assertNonEmpty(account.tenantId, "posting rule account tenantId");
    assertNonEmpty(account.sourceId, "posting rule account sourceId");
    assertNonEmpty(account.accountId, "posting rule account accountId");
    if (typeof account.active !== "boolean") {
      throw new Error("posting rule account active must be a boolean");
    }
    if (account.tenantId !== input.tenantId || account.sourceId !== input.sourceId) {
      continue;
    }
    if (scopedAccountIds.has(account.accountId)) {
      throw new Error(`posting rule evaluation contains duplicate account: ${account.accountId}`);
    }
    scopedAccountIds.add(account.accountId);
  }
}

function isEligibleRule(input: PostingRuleEvaluationInput, rule: PostingRule): boolean {
  return (
    rule.tenantId === input.tenantId &&
    rule.sourceId === input.sourceId &&
    rule.status === "active" &&
    (rule.effectiveFrom === undefined || rule.effectiveFrom <= input.transactionDate) &&
    (rule.effectiveThrough === undefined || rule.effectiveThrough >= input.transactionDate)
  );
}

function compareRules(left: PostingRule, right: PostingRule): number {
  return (
    left.priority - right.priority ||
    left.ruleCode.localeCompare(right.ruleCode) ||
    left.postingRuleId.localeCompare(right.postingRuleId)
  );
}

function ruleMatches(input: PostingRuleEvaluationInput, rule: PostingRule): boolean {
  const results = rule.conditions.map((condition) => conditionMatches(input, condition));
  return rule.conditionMode === "all" ? results.every(Boolean) : results.some(Boolean);
}

function conditionMatches(input: PostingRuleEvaluationInput, condition: PostingRuleCondition): boolean {
  if (condition.field === "amount") {
    const actual = parseMoney(input.amount, "posting rule evaluation amount");
    if (condition.operator === "between") {
      const lower = parseMoney(condition.value[0], "posting rule amount lower bound");
      const upper = parseMoney(condition.value[1], "posting rule amount upper bound");
      return actual >= lower && actual <= upper;
    }
    const expected = parseMoney(condition.value, "posting rule amount value");
    switch (condition.operator) {
      case "equals":
        return actual === expected;
      case "greater_than":
        return actual > expected;
      case "greater_than_or_equal":
        return actual >= expected;
      case "less_than":
        return actual < expected;
      case "less_than_or_equal":
        return actual <= expected;
    }
  }

  const actual = stringConditionValue(input, condition.field);
  if (actual === undefined) {
    return false;
  }
  switch (condition.operator) {
    case "equals":
      return actual === condition.value;
    case "not_equals":
      return actual !== condition.value;
    case "in":
      return condition.value.includes(actual);
    case "contains":
      return actual.includes(condition.value);
    case "starts_with":
      return actual.startsWith(condition.value);
  }
}

function stringConditionValue(
  input: PostingRuleEvaluationInput,
  field: Exclude<PostingRuleCondition["field"], "amount">
): string | undefined {
  switch (field) {
    case "source_transaction_type":
      return input.sourceTransactionType;
    case "transaction_number":
      return input.transactionNumber;
    case "party_id":
      return input.partyId;
    case "currency_code":
      return input.currencyCode;
    case "memo":
      return input.memo;
  }
}

function buildProposal(
  input: PostingRuleEvaluationInput,
  rule: PostingRule
): PostingRulePostingProposal | { readonly issue: PostingRuleEvaluationIssue } {
  const lines: PostingRuleProposalLine[] = [];
  for (const [index, action] of rule.actions.entries()) {
    const account = input.accounts.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.sourceId === input.sourceId &&
        candidate.accountId === action.accountId
    );
    if (account === undefined) {
      return {
        issue: {
          code: "unknown_account",
          message: `posting rule action ${String(index + 1)} references an unknown account: ${action.accountId}`,
          postingRuleIds: [rule.postingRuleId]
        }
      };
    }
    if (!account.active) {
      return {
        issue: {
          code: "inactive_account",
          message: `posting rule action ${String(index + 1)} references an inactive account: ${action.accountId}`,
          postingRuleIds: [rule.postingRuleId]
        }
      };
    }
    const amountMinor = actionAmountMinor(input, action);
    if (typeof amountMinor !== "bigint") {
      return {
        issue: {
          ...amountMinor,
          postingRuleIds: [rule.postingRuleId]
        }
      };
    }
    if (amountMinor === 0n) {
      return {
        issue: {
          code: "rounded_action_to_zero",
          message: `posting rule action ${String(index + 1)} rounded to zero`,
          postingRuleIds: [rule.postingRuleId]
        }
      };
    }
    if (action.partySource === "transaction_party" && input.partyId === undefined) {
      return {
        issue: {
          code: "missing_transaction_party",
          message: `posting rule action ${String(index + 1)} requires a transaction party`,
          postingRuleIds: [rule.postingRuleId]
        }
      };
    }
    const amount = formatMoney(amountMinor);
    lines.push({
      sequence: index + 1,
      side: action.side,
      accountId: action.accountId,
      amount,
      debitAmount: action.side === "debit" ? amount : "0.00",
      creditAmount: action.side === "credit" ? amount : "0.00",
      ...(action.partySource === "transaction_party" && input.partyId !== undefined ? { partyId: input.partyId } : {}),
      dimensionRefs: actionDimensions(input, action),
      ...(action.description === undefined ? {} : { description: action.description })
    });
  }

  const debitMinor = lines.reduce((total, line) => total + parseMoney(line.debitAmount, "proposal debit"), 0n);
  const creditMinor = lines.reduce((total, line) => total + parseMoney(line.creditAmount, "proposal credit"), 0n);
  if (debitMinor !== creditMinor) {
    return {
      issue: {
        code: "unbalanced_rule_actions",
        message: `posting rule actions are unbalanced: debits ${formatMoney(debitMinor)}, credits ${formatMoney(creditMinor)}`,
        postingRuleIds: [rule.postingRuleId]
      }
    };
  }

  return {
    postingRuleId: rule.postingRuleId,
    ruleCode: rule.ruleCode,
    transactionId: input.transactionId,
    currencyCode: input.currencyCode,
    lines,
    totalDebit: formatMoney(debitMinor),
    totalCredit: formatMoney(creditMinor)
  };
}

function actionAmountMinor(
  input: PostingRuleEvaluationInput,
  action: PostingRuleAction
): bigint | PostingRuleEvaluationIssue {
  switch (action.amount.kind) {
    case "transaction_amount":
      return parseMoney(input.amount, "posting rule evaluation amount");
    case "unapplied_amount":
      return input.unappliedAmount === undefined
        ? {
            code: "missing_unapplied_amount",
            message: "posting rule action requires unappliedAmount",
            postingRuleIds: []
          }
        : parseMoney(input.unappliedAmount, "posting rule evaluation unappliedAmount");
    case "fixed_amount":
      return parseMoney(action.amount.amount, "posting rule fixed amount");
    case "percentage":
      return percentageOfMoney(
        parseMoney(input.amount, "posting rule evaluation amount"),
        action.amount.percentage
      );
  }
}

function actionDimensions(input: PostingRuleEvaluationInput, action: PostingRuleAction): readonly DimensionRef[] {
  if (action.dimensionSource === "transaction_dimensions") {
    return [...(input.dimensionRefs ?? [])];
  }
  return [...(action.dimensionRefs ?? [])];
}

function percentageOfMoney(amountMinor: bigint, percentage: DecimalString): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(percentage);
  if (match === null || match[1] === undefined) {
    throw new Error(`posting rule percentage must be a positive decimal: ${percentage}`);
  }
  const fraction = match[2] ?? "";
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(match[1]) * scale + BigInt(fraction.length === 0 ? "0" : fraction);
  const denominator = 100n * scale;
  return (amountMinor * numerator + denominator / 2n) / denominator;
}

function parseMoney(value: DecimalString, label: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null || match[1] === undefined) {
    throw new Error(`${label} must be a nonnegative decimal with at most two fractional digits`);
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return BigInt(match[1]) * 100n + BigInt(fraction.length === 0 ? "0" : fraction);
}

function formatMoney(value: bigint): DecimalString {
  const whole = value / 100n;
  const fraction = value % 100n;
  return `${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}
