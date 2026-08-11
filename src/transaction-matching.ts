import {
  DEFAULT_JSON_REF_MAX_BYTES,
  assertNoCredentialKeys
} from "./canonical-model.js";

import type {
  AccountId,
  DecimalString,
  DimensionRef,
  IsoCurrencyCode,
  IsoDate,
  IsoDateTime,
  JsonValue,
  SourceScopedRecord,
  TransactionId
} from "./canonical-model.js";

export type PostingRuleId = string;
export type TransactionMatchCandidateId = string;
export type TransactionMatchDecisionId = string;
export type PaymentApplicationId = string;

export type PostingRuleStatus = "draft" | "active" | "inactive" | "archived";
export type PostingRuleConditionMode = "all" | "any";
export type PostingRuleStringField =
  | "source_transaction_type"
  | "transaction_number"
  | "party_id"
  | "currency_code"
  | "memo";
export type PostingRuleStringOperator = "equals" | "not_equals" | "in" | "contains" | "starts_with";
export type PostingRuleAmountOperator =
  | "equals"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "between";

export type PostingRuleStringCondition =
  | {
      readonly field: PostingRuleStringField;
      readonly operator: "in";
      readonly value: readonly string[];
    }
  | {
      readonly field: PostingRuleStringField;
      readonly operator: Exclude<PostingRuleStringOperator, "in">;
      readonly value: string;
    };

export type PostingRuleAmountCondition =
  | {
      readonly field: "amount";
      readonly operator: "between";
      readonly value: readonly [DecimalString, DecimalString];
    }
  | {
      readonly field: "amount";
      readonly operator: Exclude<PostingRuleAmountOperator, "between">;
      readonly value: DecimalString;
    };

export type PostingRuleCondition = PostingRuleStringCondition | PostingRuleAmountCondition;

export type PostingRuleAmountSource =
  | { readonly kind: "transaction_amount" }
  | { readonly kind: "unapplied_amount" }
  | { readonly kind: "fixed_amount"; readonly amount: DecimalString }
  | { readonly kind: "percentage"; readonly percentage: DecimalString };

export type PostingRuleAction = {
  readonly kind: "create_posting";
  readonly side: "debit" | "credit";
  readonly accountId: AccountId;
  readonly amount: PostingRuleAmountSource;
  readonly partySource?: "transaction_party" | "none";
  readonly dimensionSource?: "transaction_dimensions" | "none";
  readonly dimensionRefs?: readonly DimensionRef[];
  readonly description?: string;
};

/**
 * Provider-neutral posting policy. Host applications own the configured rule
 * values and approval workflow; this contract owns deterministic rule inputs
 * and posting actions.
 */
export type PostingRule = SourceScopedRecord & {
  readonly postingRuleId: PostingRuleId;
  readonly ruleCode: string;
  readonly name: string;
  readonly description?: string;
  readonly priority: number;
  readonly status: PostingRuleStatus;
  readonly conditionMode: PostingRuleConditionMode;
  readonly conditions: readonly PostingRuleCondition[];
  readonly actions: readonly PostingRuleAction[];
  readonly effectiveFrom?: IsoDate;
  readonly effectiveThrough?: IsoDate;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
};

export type TransactionMatchKind = "customer_payment_to_invoice" | "vendor_payment_to_bill";
export type TransactionMatchCandidateStatus = "suggested" | "accepted" | "rejected" | "expired" | "superseded";
export type TransactionMatchCriterion = "party" | "amount" | "reference" | "date" | "currency";

export type TransactionMatchEvidence = {
  readonly criterion: TransactionMatchCriterion;
  readonly matched: boolean;
  readonly weight: DecimalString;
  readonly score: DecimalString;
  readonly detail?: string;
};

export type TransactionMatchCandidate = SourceScopedRecord & {
  readonly matchCandidateId: TransactionMatchCandidateId;
  readonly matchKind: TransactionMatchKind;
  readonly originTransactionId: TransactionId;
  readonly targetTransactionId: TransactionId;
  readonly matcherVersion: string;
  readonly score: DecimalString;
  readonly suggestedApplicationAmount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly status: TransactionMatchCandidateStatus;
  readonly evidence: readonly TransactionMatchEvidence[];
  readonly createdAt: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
};

export type TransactionMatchDecisionValue = "accepted" | "rejected" | "superseded";
export type TransactionMatchDecisionMethod = "automatic" | "manual";

/** Append-only audit record for a match decision. */
export type TransactionMatchDecision = SourceScopedRecord & {
  readonly matchDecisionId: TransactionMatchDecisionId;
  readonly matchCandidateId: TransactionMatchCandidateId;
  readonly decision: TransactionMatchDecisionValue;
  readonly method: TransactionMatchDecisionMethod;
  readonly decidedAt: IsoDateTime;
  readonly decidedByRef?: string;
  readonly reason?: string;
  readonly evidence?: JsonValue;
};

export type PaymentApplicationStatus = "proposed" | "posted" | "voided";

/** Allocation of one customer payment to one invoice. */
export type PaymentApplication = SourceScopedRecord & {
  readonly paymentApplicationId: PaymentApplicationId;
  readonly paymentTransactionId: TransactionId;
  readonly invoiceTransactionId: TransactionId;
  readonly matchDecisionId?: TransactionMatchDecisionId;
  readonly appliedAmount: DecimalString;
  readonly currencyCode: IsoCurrencyCode;
  readonly applicationDate: IsoDate;
  readonly status: PaymentApplicationStatus;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
};

export function assertPostingRule(value: unknown): asserts value is PostingRule {
  const rule = postingRuleFromUnknown(value);
  assertNonEmpty(rule.postingRuleId, "postingRuleId");
  assertNonEmpty(rule.ruleCode, "ruleCode");
  assertNonEmpty(rule.name, "name");
  if (!Number.isInteger(rule.priority) || rule.priority < 0) {
    throw new Error("posting rule priority must be a nonnegative integer");
  }
  if (rule.effectiveFrom !== undefined && rule.effectiveThrough !== undefined && rule.effectiveFrom > rule.effectiveThrough) {
    throw new Error("posting rule effectiveFrom must be on or before effectiveThrough");
  }
  if (Date.parse(rule.updatedAt) < Date.parse(rule.createdAt)) {
    throw new Error("posting rule updatedAt must be on or after createdAt");
  }
  if (rule.conditions.length === 0) {
    throw new Error("posting rule must include at least one condition");
  }
  if (rule.actions.length === 0) {
    throw new Error("posting rule must include at least one action");
  }

  assertBoundedJson(rule.conditions, "posting rule conditions");
  assertBoundedJson(rule.actions, "posting rule actions");
  if (!rule.actions.some((action) => action.side === "debit") || !rule.actions.some((action) => action.side === "credit")) {
    throw new Error("posting rule actions must include at least one debit and one credit");
  }
}

export function assertTransactionMatchCandidate(value: unknown): asserts value is TransactionMatchCandidate {
  const candidate = transactionMatchCandidateFromUnknown(value);
  assertNonEmpty(candidate.matchCandidateId, "matchCandidateId");
  assertNonEmpty(candidate.originTransactionId, "originTransactionId");
  assertNonEmpty(candidate.targetTransactionId, "targetTransactionId");
  assertNonEmpty(candidate.matcherVersion, "matcherVersion");
  assertNonEmpty(candidate.currencyCode, "currencyCode");
  if (candidate.originTransactionId === candidate.targetTransactionId) {
    throw new Error("match candidate origin and target transactions must differ");
  }
  assertUnitDecimal(candidate.score, "match candidate score");
  assertPositiveMoney(candidate.suggestedApplicationAmount, "suggested application amount");
  if (candidate.evidence.length === 0) {
    throw new Error("match candidate must include at least one evidence item");
  }
  const criterionSet = new Set<TransactionMatchCriterion>();
  const fixedScale = 1_000_000n;
  let totalWeight = 0n;
  let weightedScore = 0n;
  for (const evidence of candidate.evidence) {
    assertNonNegativeDecimal(evidence.weight, "match evidence weight");
    assertUnitDecimal(evidence.score, "match evidence score");
    if (criterionSet.has(evidence.criterion)) {
      throw new Error(`match candidate evidence criterion is duplicated: ${evidence.criterion}`);
    }
    criterionSet.add(evidence.criterion);
    const weight = decimalAtScale(parseDecimal(evidence.weight, "match evidence weight", 6), fixedScale);
    const score = decimalAtScale(parseDecimal(evidence.score, "match evidence score", 6), fixedScale);
    totalWeight += weight;
    weightedScore += weight * score;
  }
  if (totalWeight !== fixedScale) {
    throw new Error("match candidate evidence weights must total 1");
  }
  const expectedScore = divideRoundedHalfUp(weightedScore, fixedScale);
  const candidateScore = decimalAtScale(parseDecimal(candidate.score, "match candidate score", 6), fixedScale);
  if (candidateScore !== expectedScore) {
    throw new Error("match candidate score must equal its weighted evidence score");
  }
  if (candidate.expiresAt !== undefined && Date.parse(candidate.expiresAt) <= Date.parse(candidate.createdAt)) {
    throw new Error("match candidate expiresAt must be after createdAt");
  }
  assertBoundedJson(candidate.evidence, "match candidate evidence");
}

export function assertTransactionMatchDecision(value: unknown): asserts value is TransactionMatchDecision {
  const decision = transactionMatchDecisionFromUnknown(value);
  assertNonEmpty(decision.matchDecisionId, "matchDecisionId");
  assertNonEmpty(decision.matchCandidateId, "matchCandidateId");
  if (decision.decidedByRef !== undefined) {
    assertNonEmpty(decision.decidedByRef, "decidedByRef");
  }
  if (decision.method === "manual" && decision.decidedByRef === undefined) {
    throw new Error("manual match decision must include decidedByRef");
  }
  if (decision.evidence !== undefined) {
    assertBoundedJson(decision.evidence, "match decision evidence");
  }
}

export function assertPaymentApplication(value: unknown): asserts value is PaymentApplication {
  const application = paymentApplicationFromUnknown(value);
  assertNonEmpty(application.paymentApplicationId, "paymentApplicationId");
  assertNonEmpty(application.paymentTransactionId, "paymentTransactionId");
  assertNonEmpty(application.invoiceTransactionId, "invoiceTransactionId");
  assertNonEmpty(application.currencyCode, "currencyCode");
  if (application.paymentTransactionId === application.invoiceTransactionId) {
    throw new Error("payment and invoice transactions must differ");
  }
  assertPositiveMoney(application.appliedAmount, "payment application amount");
  if (Date.parse(application.updatedAt) < Date.parse(application.createdAt)) {
    throw new Error("payment application updatedAt must be on or after createdAt");
  }
}

function postingRuleFromUnknown(value: unknown): PostingRule {
  const rule = recordFromUnknown(value, "posting rule");
  assertSourceScope(rule, "posting rule");
  assertStringField(rule, "postingRuleId", "postingRuleId");
  assertStringField(rule, "ruleCode", "ruleCode");
  assertStringField(rule, "name", "name");
  assertOptionalStringField(rule, "description", "posting rule description");
  if (typeof rule.priority !== "number") {
    throw new Error("posting rule priority must be a number");
  }
  assertEnum(rule.status, ["draft", "active", "inactive", "archived"], "posting rule status");
  assertEnum(rule.conditionMode, ["all", "any"], "posting rule conditionMode");
  if (!Array.isArray(rule.conditions)) {
    throw new Error("posting rule conditions must be an array");
  }
  if (!Array.isArray(rule.actions)) {
    throw new Error("posting rule actions must be an array");
  }
  rule.conditions.forEach((condition) => {
    assertPostingRuleCondition(condition);
  });
  rule.actions.forEach((action) => {
    assertPostingRuleAction(action);
  });
  assertOptionalStringField(rule, "effectiveFrom", "posting rule effectiveFrom");
  assertOptionalStringField(rule, "effectiveThrough", "posting rule effectiveThrough");
  assertStringField(rule, "createdAt", "posting rule createdAt");
  assertStringField(rule, "updatedAt", "posting rule updatedAt");
  if (typeof rule.effectiveFrom === "string") {
    assertIsoDate(rule.effectiveFrom, "posting rule effectiveFrom");
  }
  if (typeof rule.effectiveThrough === "string") {
    assertIsoDate(rule.effectiveThrough, "posting rule effectiveThrough");
  }
  assertIsoDateTime(rule.createdAt as string, "posting rule createdAt");
  assertIsoDateTime(rule.updatedAt as string, "posting rule updatedAt");
  return rule as unknown as PostingRule;
}

function transactionMatchCandidateFromUnknown(value: unknown): TransactionMatchCandidate {
  const candidate = recordFromUnknown(value, "transaction match candidate");
  assertSourceScope(candidate, "transaction match candidate");
  assertStringField(candidate, "matchCandidateId", "matchCandidateId");
  assertEnum(
    candidate.matchKind,
    ["customer_payment_to_invoice", "vendor_payment_to_bill"],
    "match candidate matchKind"
  );
  assertStringField(candidate, "originTransactionId", "originTransactionId");
  assertStringField(candidate, "targetTransactionId", "targetTransactionId");
  assertStringField(candidate, "matcherVersion", "matcherVersion");
  assertStringField(candidate, "score", "match candidate score");
  assertStringField(candidate, "suggestedApplicationAmount", "suggested application amount");
  assertStringField(candidate, "currencyCode", "currencyCode");
  assertEnum(
    candidate.status,
    ["suggested", "accepted", "rejected", "expired", "superseded"],
    "match candidate status"
  );
  if (!Array.isArray(candidate.evidence)) {
    throw new Error("match candidate evidence must be an array");
  }
  candidate.evidence.forEach((evidence) => {
    assertTransactionMatchEvidence(evidence);
  });
  assertStringField(candidate, "createdAt", "match candidate createdAt");
  assertOptionalStringField(candidate, "expiresAt", "match candidate expiresAt");
  assertIsoDateTime(candidate.createdAt as string, "match candidate createdAt");
  if (typeof candidate.expiresAt === "string") {
    assertIsoDateTime(candidate.expiresAt, "match candidate expiresAt");
  }
  return candidate as unknown as TransactionMatchCandidate;
}

function transactionMatchDecisionFromUnknown(value: unknown): TransactionMatchDecision {
  const decision = recordFromUnknown(value, "transaction match decision");
  assertSourceScope(decision, "transaction match decision");
  assertStringField(decision, "matchDecisionId", "matchDecisionId");
  assertStringField(decision, "matchCandidateId", "matchCandidateId");
  assertEnum(decision.decision, ["accepted", "rejected", "superseded"], "match decision value");
  assertEnum(decision.method, ["automatic", "manual"], "match decision method");
  assertStringField(decision, "decidedAt", "match decision decidedAt");
  assertOptionalStringField(decision, "decidedByRef", "decidedByRef");
  assertOptionalStringField(decision, "reason", "match decision reason");
  if (decision.evidence !== undefined) {
    assertJsonValue(decision.evidence, "match decision evidence");
  }
  assertIsoDateTime(decision.decidedAt as string, "match decision decidedAt");
  return decision as unknown as TransactionMatchDecision;
}

function paymentApplicationFromUnknown(value: unknown): PaymentApplication {
  const application = recordFromUnknown(value, "payment application");
  assertSourceScope(application, "payment application");
  assertStringField(application, "paymentApplicationId", "paymentApplicationId");
  assertStringField(application, "paymentTransactionId", "paymentTransactionId");
  assertStringField(application, "invoiceTransactionId", "invoiceTransactionId");
  assertOptionalStringField(application, "matchDecisionId", "matchDecisionId");
  assertStringField(application, "appliedAmount", "payment application amount");
  assertStringField(application, "currencyCode", "currencyCode");
  assertStringField(application, "applicationDate", "applicationDate");
  assertEnum(application.status, ["proposed", "posted", "voided"], "payment application status");
  assertStringField(application, "createdAt", "payment application createdAt");
  assertStringField(application, "updatedAt", "payment application updatedAt");
  assertIsoDate(application.applicationDate as string, "payment application applicationDate");
  assertIsoDateTime(application.createdAt as string, "payment application createdAt");
  assertIsoDateTime(application.updatedAt as string, "payment application updatedAt");
  return application as unknown as PaymentApplication;
}

function assertPostingRuleCondition(value: unknown): asserts value is PostingRuleCondition {
  const condition = recordFromUnknown(value, "posting rule condition");
  assertEnum(
    condition.field,
    ["source_transaction_type", "transaction_number", "party_id", "currency_code", "memo", "amount"],
    "posting rule condition field"
  );
  if (condition.field === "amount") {
    assertEnum(
      condition.operator,
      ["equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "between"],
      "posting rule amount operator"
    );
    if (condition.operator === "between") {
      if (!Array.isArray(condition.value) || condition.value.length !== 2) {
        throw new Error("posting rule amount between condition must include two values");
      }
      const amountValues = condition.value as unknown[];
      const lower = amountValues[0];
      const upper = amountValues[1];
      if (typeof lower !== "string" || typeof upper !== "string") {
        throw new Error("posting rule amount between values must be decimal strings");
      }
      const lowerDecimal = parseDecimal(lower, "posting rule amount lower bound", 2);
      const upperDecimal = parseDecimal(upper, "posting rule amount upper bound", 2);
      if (lowerDecimal.negative || upperDecimal.negative) {
        throw new Error("posting rule amount bounds must be nonnegative");
      }
      if (compareDecimals(lowerDecimal, upperDecimal) > 0) {
        throw new Error("posting rule amount lower bound must not exceed upper bound");
      }
      return;
    }
    if (typeof condition.value !== "string") {
      throw new Error(`posting rule amount ${condition.operator} condition must include one value`);
    }
    if (parseDecimal(condition.value, "posting rule amount value", 2).negative) {
      throw new Error("posting rule amount value must be nonnegative");
    }
    return;
  }

  assertEnum(
    condition.operator,
    ["equals", "not_equals", "in", "contains", "starts_with"],
    "posting rule string operator"
  );
  if (condition.operator === "in") {
    if (!Array.isArray(condition.value) || condition.value.length === 0) {
      throw new Error("posting rule in condition must include at least one value");
    }
    condition.value.forEach((value) => {
      if (typeof value !== "string") {
        throw new Error("posting rule in condition values must be strings");
      }
      assertNonEmpty(value, "posting rule condition value");
    });
    return;
  }
  if (typeof condition.value !== "string") {
    throw new Error(`posting rule ${condition.operator} condition must include one value`);
  }
  assertNonEmpty(condition.value, "posting rule condition value");
}

function assertPostingRuleAction(value: unknown): asserts value is PostingRuleAction {
  const action = recordFromUnknown(value, "posting rule action");
  if (action.kind !== "create_posting") {
    throw new Error("posting rule action kind must be create_posting");
  }
  assertEnum(action.side, ["debit", "credit"], "posting rule action side");
  assertStringField(action, "accountId", "posting rule action accountId");
  assertNonEmpty(action.accountId as string, "posting rule action accountId");
  const amount = recordFromUnknown(action.amount, "posting rule action amount");
  assertEnum(
    amount.kind,
    ["transaction_amount", "unapplied_amount", "fixed_amount", "percentage"],
    "posting rule action amount kind"
  );
  if (amount.kind === "fixed_amount") {
    assertStringField(amount, "amount", "posting rule fixed amount");
    assertPositiveMoney(amount.amount as string, "posting rule fixed amount");
  }
  if (amount.kind === "percentage") {
    assertStringField(amount, "percentage", "posting rule percentage");
    const percentage = parseDecimal(amount.percentage as string, "posting rule percentage", 6);
    if (percentage.negative || percentage.magnitude === 0n || compareDecimalToInteger(percentage, 100n) > 0) {
      throw new Error("posting rule percentage must be greater than 0 and no more than 100");
    }
  }
  if (action.partySource !== undefined) {
    assertEnum(action.partySource, ["transaction_party", "none"], "posting rule action partySource");
  }
  if (action.dimensionSource !== undefined) {
    assertEnum(
      action.dimensionSource,
      ["transaction_dimensions", "none"],
      "posting rule action dimensionSource"
    );
  }
  if (action.dimensionRefs !== undefined) {
    if (!Array.isArray(action.dimensionRefs)) {
      throw new Error("posting rule action dimensionRefs must be an array");
    }
    action.dimensionRefs.forEach((dimensionRef) => {
      assertDimensionRef(dimensionRef);
    });
  }
  if (action.dimensionSource === "transaction_dimensions" && action.dimensionRefs !== undefined) {
    throw new Error("posting rule action cannot combine transaction dimensions with explicit dimensionRefs");
  }
  assertOptionalStringField(action, "description", "posting rule action description");
}

function assertTransactionMatchEvidence(value: unknown): asserts value is TransactionMatchEvidence {
  const evidence = recordFromUnknown(value, "transaction match evidence");
  assertEnum(evidence.criterion, ["party", "amount", "reference", "date", "currency"], "match evidence criterion");
  if (typeof evidence.matched !== "boolean") {
    throw new Error("match evidence matched must be a boolean");
  }
  assertStringField(evidence, "weight", "match evidence weight");
  assertStringField(evidence, "score", "match evidence score");
  assertOptionalStringField(evidence, "detail", "match evidence detail");
}

function assertDimensionRef(value: unknown): void {
  const dimensionRef = recordFromUnknown(value, "dimension ref");
  assertStringField(dimensionRef, "dimensionKind", "dimension ref dimensionKind");
  assertOptionalStringField(dimensionRef, "dimensionId", "dimension ref dimensionId");
  assertOptionalStringField(dimensionRef, "sourceDimensionId", "dimension ref sourceDimensionId");
  assertOptionalStringField(dimensionRef, "name", "dimension ref name");
}

function assertBoundedJson(value: unknown, label: string): void {
  assertJsonValue(value, label);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }
  if (Buffer.byteLength(serialized, "utf8") > DEFAULT_JSON_REF_MAX_BYTES) {
    throw new Error(`${label} exceeds ${String(DEFAULT_JSON_REF_MAX_BYTES)} serialized bytes`);
  }
  assertNoCredentialKeys(value);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertUnitDecimal(value: DecimalString, label: string): void {
  const decimal = parseDecimal(value, label, 6);
  if (decimal.negative || compareDecimalToInteger(decimal, 1n) > 0) {
    throw new Error(`${label} must be between 0 and 1`);
  }
}

function assertNonNegativeDecimal(value: DecimalString, label: string): void {
  if (parseDecimal(value, label, 6).negative) {
    throw new Error(`${label} must be nonnegative`);
  }
}

function assertPositiveMoney(value: DecimalString, label: string): void {
  const decimal = parseDecimal(value, label, 2);
  if (decimal.negative || decimal.magnitude === 0n) {
    throw new Error(`${label} must be greater than 0`);
  }
}

type ParsedDecimal = {
  readonly negative: boolean;
  readonly magnitude: bigint;
  readonly scale: bigint;
};

function parseDecimal(value: DecimalString, label: string, maximumFractionDigits: number): ParsedDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`${label} must be a decimal string`);
  }
  const fraction = match[3] ?? "";
  if (fraction.length > maximumFractionDigits) {
    throw new Error(`${label} must have at most ${String(maximumFractionDigits)} fractional digits`);
  }
  const scale = 10n ** BigInt(fraction.length);
  const magnitude = BigInt(match[2]) * scale + BigInt(fraction.length === 0 ? "0" : fraction);
  return {
    negative: match[1] === "-" && magnitude !== 0n,
    magnitude,
    scale
  };
}

function compareDecimals(left: ParsedDecimal, right: ParsedDecimal): number {
  const leftSigned = (left.negative ? -left.magnitude : left.magnitude) * right.scale;
  const rightSigned = (right.negative ? -right.magnitude : right.magnitude) * left.scale;
  return leftSigned < rightSigned ? -1 : leftSigned > rightSigned ? 1 : 0;
}

function compareDecimalToInteger(decimal: ParsedDecimal, integer: bigint): number {
  const signed = decimal.negative ? -decimal.magnitude : decimal.magnitude;
  const scaledInteger = integer * decimal.scale;
  return signed < scaledInteger ? -1 : signed > scaledInteger ? 1 : 0;
}

function decimalAtScale(decimal: ParsedDecimal, targetScale: bigint): bigint {
  if (targetScale % decimal.scale !== 0n) {
    throw new Error("decimal scale cannot be represented exactly");
  }
  const magnitude = decimal.magnitude * (targetScale / decimal.scale);
  return decimal.negative ? -magnitude : magnitude;
}

function divideRoundedHalfUp(dividend: bigint, divisor: bigint): bigint {
  return (dividend + divisor / 2n) / divisor;
}

function recordFromUnknown(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertSourceScope(value: Record<string, unknown>, label: string): void {
  assertStringField(value, "tenantId", `${label} tenantId`);
  assertStringField(value, "sourceId", `${label} sourceId`);
  assertNonEmpty(value.tenantId as string, `${label} tenantId`);
  assertNonEmpty(value.sourceId as string, `${label} sourceId`);
}

function assertStringField(value: Record<string, unknown>, field: string, label: string): void {
  if (typeof value[field] !== "string") {
    throw new Error(`${label} must be a string`);
  }
}

function assertOptionalStringField(value: Record<string, unknown>, field: string, label: string): void {
  if (value[field] !== undefined && typeof value[field] !== "string") {
    throw new Error(`${label} must be a string when provided`);
  }
}

function assertEnum(value: unknown, allowed: readonly string[], label: string): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
}

function assertIsoDate(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`${label} must be an ISO date`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} must be an ISO date`);
  }
}

function assertIsoDateTime(value: string, label: string): void {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be an ISO date-time`);
  }
  assertIsoDate(match[1], label);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = Number(match[6] ?? "0");
  const offsetMinute = Number(match[7] ?? "0");
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    throw new Error(`${label} must be an ISO date-time`);
  }
}

function assertJsonValue(value: unknown, label: string, seen = new WeakSet()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must contain only finite JSON numbers`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${label} must contain only JSON values`);
  }
  if (seen.has(value)) {
    throw new Error(`${label} must not contain circular references`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      assertJsonValue(entry, label, seen);
    });
  } else {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must contain only plain JSON objects`);
    }
    Object.values(value as Record<string, unknown>).forEach((entry) => {
      assertJsonValue(entry, label, seen);
    });
  }
  seen.delete(value);
}
