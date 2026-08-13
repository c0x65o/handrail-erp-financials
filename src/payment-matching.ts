import { createHash } from "node:crypto";

import { assertNoCredentialKeys } from "./canonical-model.js";
import { createErpFinancials } from "./erp-financials-service.js";
import { appendFinancialOutboxEvent } from "./financial-outbox.js";
import { appendFinancialLifecycleEvent, assertFinancialOperationContext } from "./financial-lifecycle.js";
import { ErpFinancialsError } from "./sdk-errors.js";

import type { DecimalString, IsoCurrencyCode, IsoDate, IsoDateTime, JsonValue } from "./canonical-model.js";
import type {
  ErpFinancialsTransactionRunner,
  SubledgerApplicationResult,
  SubledgerApplicationType
} from "./erp-financials-service.js";
import type { FinancialOperationContext } from "./financial-lifecycle.js";
import type { PostgresQueryClient } from "./postgres-storage.js";
import type { TransactionMatchDecisionMethod } from "./transaction-matching.js";

export type AcceptPaymentMatchInput = {
  readonly operation: FinancialOperationContext;
  readonly matchCandidateId: string;
  readonly sourceDocumentId: string;
  readonly targetDocumentId: string;
  readonly amount: DecimalString;
  readonly applicationDate: IsoDate;
  readonly expectedSourceVersion: number;
  readonly expectedTargetVersion: number;
  readonly idempotencyKey: string;
  readonly method: TransactionMatchDecisionMethod;
  readonly reason?: string;
  readonly evidence?: JsonValue;
};

export type AcceptPaymentMatchResult = {
  readonly matchDecisionId: string;
  readonly application: SubledgerApplicationResult;
};

export type PaymentMatchingService = {
  acceptAndApply(input: AcceptPaymentMatchInput): Promise<AcceptPaymentMatchResult>;
  reject(input: {
    readonly operation: FinancialOperationContext;
    readonly matchCandidateId: string;
    readonly idempotencyKey: string;
    readonly method: TransactionMatchDecisionMethod;
    readonly reason: string;
    readonly evidence?: JsonValue;
  }): Promise<{ readonly matchDecisionId: string; readonly status: "rejected" | "already_rejected" }>;
};

type Scope = {
  readonly database: ErpFinancialsTransactionRunner;
  readonly tenantId: string;
  readonly companyId: string;
  readonly bookId: string;
  readonly sourceId: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly now: () => IsoDateTime;
};

export function createPaymentMatchingService(input: {
  readonly database: ErpFinancialsTransactionRunner;
  readonly tenantId: string;
  readonly companyId: string;
  readonly bookId: string;
  readonly sourceId: string;
  readonly currencyCode: IsoCurrencyCode;
  readonly now?: () => IsoDateTime;
}): PaymentMatchingService {
  const scope: Scope = { ...input, now: input.now ?? (() => new Date().toISOString()) };
  for (const [field, value] of Object.entries({
    tenantId: input.tenantId,
    companyId: input.companyId,
    bookId: input.bookId,
    sourceId: input.sourceId
  })) {
    assertNonEmpty(value, field);
  }
  if (!/^[A-Z]{3}$/u.test(input.currencyCode)) {
    throw new ErpFinancialsError("invalid_input", "currencyCode must be a three-letter uppercase ISO currency code");
  }
  return {
    acceptAndApply: (command) => acceptAndApply(scope, command),
    reject: (command) => reject(scope, command)
  };
}

async function acceptAndApply(scope: Scope, input: AcceptPaymentMatchInput): Promise<AcceptPaymentMatchResult> {
  validateDecisionInput(input);
  assertDate(input.applicationDate, "applicationDate");
  if (!Number.isInteger(input.expectedSourceVersion) || input.expectedSourceVersion < 1 ||
    !Number.isInteger(input.expectedTargetVersion) || input.expectedTargetVersion < 1) {
    throw new ErpFinancialsError("invalid_input", "expected source and target versions must be positive integers");
  }
  const matchDecisionId = decisionId(scope, input.idempotencyKey);
  return scope.database.transaction(async (client) => {
    const candidate = await lockCandidate(client, scope, input.matchCandidateId);
    assertCandidateUsable(candidate, scope.now());
    const existingDecision = await loadDecision(client, scope, matchDecisionId);
    if (candidate.status === "accepted" && existingDecision === undefined) {
      throw new ErpFinancialsError("terminal_state_conflict", "Match candidate was already accepted by another decision");
    }
    const applicationType = applicationTypeFor(string(candidate.match_kind, "match_kind"));
    const decisionEvidence = input.evidence ?? parsedJson(candidate.evidence, "candidate.evidence");
    assertNoCredentialKeys(decisionEvidence);
    assertBoundedJson(decisionEvidence, "evidence");
    await insertDecision(client, scope, {
      matchDecisionId,
      matchCandidateId: input.matchCandidateId,
      decision: "accepted",
      method: input.method,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      evidence: decisionEvidence,
      operation: input.operation
    });
    await client.query(
      `update "erp_financials"."transaction_match_candidates" set "status" = 'accepted'
where "tenant_id" = $1 and "source_id" = $2 and "match_candidate_id" = $3 and "status" in ('suggested', 'accepted')`,
      [scope.tenantId, scope.sourceId, input.matchCandidateId]
    );
    const nested = { transaction: async <Result>(work: (nestedClient: PostgresQueryClient) => Promise<Result>) => work(client) };
    const service = createErpFinancials({
      database: nested, tenantId: scope.tenantId, companyId: scope.companyId, sourceId: scope.sourceId,
      bookId: scope.bookId, currencyCode: scope.currencyCode, currencyPolicy: "single_currency", now: scope.now
    });
    const application = await service.paymentApplications.apply({
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      applicationType,
      sourceDocumentId: input.sourceDocumentId,
      targetDocumentId: input.targetDocumentId,
      amount: input.amount,
      applicationDate: input.applicationDate,
      expectedSourceVersion: input.expectedSourceVersion,
      expectedTargetVersion: input.expectedTargetVersion,
      match: {
        matchCandidateId: input.matchCandidateId,
        matchDecisionId,
        method: input.method,
        score: decimal(candidate.score, "candidate.score"),
        evidence: decisionEvidence
      }
    });
    const lifecycle = await appendFinancialLifecycleEvent(client, {
      tenantId: scope.tenantId, companyId: scope.companyId, sourceId: scope.sourceId,
      aggregateType: "transaction_match_candidate", aggregateId: input.matchCandidateId,
      eventType: "payment_match.accepted_and_applied",
      idempotencyKey: `payment-match:${input.idempotencyKey}:accepted-and-applied`,
      operation: input.operation, recordedAt: scope.now(),
      payload: { applicationId: application.applicationId, matchDecisionId }
    });
    await appendFinancialOutboxEvent(client, {
      tenantId: scope.tenantId, companyId: scope.companyId, bookId: scope.bookId, sourceId: scope.sourceId,
      eventType: "payment_match.accepted_and_applied", aggregateType: "transaction_match_candidate",
      aggregateId: input.matchCandidateId, idempotencyKey: `payment-match:${input.idempotencyKey}:outbox:accepted-and-applied`,
      payload: { applicationId: application.applicationId, matchDecisionId }, availableAt: scope.now()
    });
    void lifecycle;
    return { matchDecisionId, application };
  });
}

async function reject(
  scope: Scope,
  input: {
    readonly operation: FinancialOperationContext;
    readonly matchCandidateId: string;
    readonly idempotencyKey: string;
    readonly method: TransactionMatchDecisionMethod;
    readonly reason: string;
    readonly evidence?: JsonValue;
  }
): Promise<{ readonly matchDecisionId: string; readonly status: "rejected" | "already_rejected" }> {
  validateDecisionInput(input);
  if (input.reason.trim().length === 0) throw new ErpFinancialsError("invalid_input", "Rejected matches require a reason");
  const matchDecisionId = decisionId(scope, input.idempotencyKey);
  return scope.database.transaction(async (client) => {
    const candidate = await lockCandidate(client, scope, input.matchCandidateId);
    const existing = await loadDecision(client, scope, matchDecisionId);
    if (existing !== undefined) {
      assertSameDecision(existing, input.matchCandidateId, "rejected", input.method, input.reason, input.evidence);
      return { matchDecisionId, status: "already_rejected" };
    }
    const status = string(candidate.status, "status");
    if (status !== "suggested") {
      throw new ErpFinancialsError("terminal_state_conflict", `Match candidate is already ${status}`);
    }
    await insertDecision(client, scope, {
      matchDecisionId, matchCandidateId: input.matchCandidateId, decision: "rejected", method: input.method,
      reason: input.reason, ...(input.evidence === undefined ? {} : { evidence: input.evidence }), operation: input.operation
    });
    await client.query(
      `update "erp_financials"."transaction_match_candidates" set "status" = 'rejected'
where "tenant_id" = $1 and "source_id" = $2 and "match_candidate_id" = $3 and "status" = 'suggested'`,
      [scope.tenantId, scope.sourceId, input.matchCandidateId]
    );
    await appendFinancialOutboxEvent(client, {
      tenantId: scope.tenantId, companyId: scope.companyId, bookId: scope.bookId, sourceId: scope.sourceId,
      eventType: "payment_match.rejected", aggregateType: "transaction_match_candidate", aggregateId: input.matchCandidateId,
      idempotencyKey: `payment-match:${input.idempotencyKey}:outbox:rejected`, payload: { matchDecisionId }, availableAt: scope.now()
    });
    return { matchDecisionId, status: "rejected" };
  });
}

async function insertDecision(
  client: PostgresQueryClient,
  scope: Scope,
  input: {
    readonly matchDecisionId: string;
    readonly matchCandidateId: string;
    readonly decision: "accepted" | "rejected";
    readonly method: TransactionMatchDecisionMethod;
    readonly reason?: string;
    readonly evidence?: JsonValue;
    readonly operation: FinancialOperationContext;
  }
): Promise<void> {
  const decidedByRef = input.method === "manual" ? input.operation.actorRef : undefined;
  if (input.evidence !== undefined) {
    assertNoCredentialKeys(input.evidence);
    assertBoundedJson(input.evidence, "evidence");
  }
  const inserted = await client.query(
    `insert into "erp_financials"."transaction_match_decisions" (
  "match_decision_id", "tenant_id", "source_id", "match_candidate_id", "decision", "method", "decided_at",
  "decided_by_ref", "reason", "evidence"
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
on conflict ("tenant_id", "source_id", "match_decision_id") do nothing returning *`,
    [input.matchDecisionId, scope.tenantId, scope.sourceId, input.matchCandidateId, input.decision, input.method,
      scope.now(), decidedByRef, input.reason, input.evidence === undefined ? undefined : JSON.stringify(input.evidence)]
  );
  if (inserted.rows[0] !== undefined) return;
  const existing = await loadDecision(client, scope, input.matchDecisionId);
  if (existing === undefined) throw new Error("Match decision conflict row was not found");
  assertSameDecision(existing, input.matchCandidateId, input.decision, input.method, input.reason, input.evidence);
}

async function lockCandidate(client: PostgresQueryClient, scope: Scope, candidateId: string): Promise<Record<string, unknown>> {
  const result = await client.query(
    `select * from "erp_financials"."transaction_match_candidates"
where "tenant_id" = $1 and "source_id" = $2 and "match_candidate_id" = $3 for update`,
    [scope.tenantId, scope.sourceId, candidateId]
  );
  if (result.rows[0] === undefined) throw new ErpFinancialsError("missing_document", `Match candidate ${candidateId} does not exist`);
  return result.rows[0];
}

async function loadDecision(
  client: PostgresQueryClient,
  scope: Scope,
  decisionIdValue: string
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(
    `select * from "erp_financials"."transaction_match_decisions"
where "tenant_id" = $1 and "source_id" = $2 and "match_decision_id" = $3 for key share`,
    [scope.tenantId, scope.sourceId, decisionIdValue]
  );
  return result.rows[0];
}

function assertCandidateUsable(candidate: Record<string, unknown>, now: IsoDateTime): void {
  const status = string(candidate.status, "status");
  if (status !== "suggested" && status !== "accepted") {
    throw new ErpFinancialsError("terminal_state_conflict", `Match candidate is ${status}`);
  }
  const expiresAt = optionalDateTime(candidate.expires_at);
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(now)) {
    throw new ErpFinancialsError("terminal_state_conflict", "Match candidate has expired");
  }
}

function assertSameDecision(
  row: Record<string, unknown>,
  candidateId: string,
  decision: "accepted" | "rejected",
  method: TransactionMatchDecisionMethod,
  reason?: string,
  evidence?: JsonValue
): void {
  if (row.match_candidate_id !== candidateId || row.decision !== decision || row.method !== method ||
    optionalString(row.reason) !== reason || stableJson(parsedOptionalJson(row.evidence)) !== stableJson(evidence)) {
    throw new ErpFinancialsError("idempotency_conflict", "Match decision idempotency key has different content");
  }
}

function validateDecisionInput(input: {
  readonly operation: FinancialOperationContext;
  readonly matchCandidateId: string;
  readonly idempotencyKey: string;
  readonly method: TransactionMatchDecisionMethod;
  readonly evidence?: JsonValue;
}): void {
  assertFinancialOperationContext(input.operation);
  assertNonEmpty(input.matchCandidateId, "matchCandidateId");
  assertNonEmpty(input.idempotencyKey, "idempotencyKey");
  const method: unknown = input.method;
  if (method !== "automatic" && method !== "manual") throw new ErpFinancialsError("invalid_input", "method must be automatic or manual");
  if (input.evidence !== undefined) {
    assertNoCredentialKeys(input.evidence);
    assertBoundedJson(input.evidence, "evidence");
  }
}

function applicationTypeFor(kind: string): SubledgerApplicationType {
  if (kind === "customer_payment_to_invoice") return "customer_payment_to_invoice";
  if (kind === "vendor_payment_to_bill") return "bill_payment_to_bill";
  throw new ErpFinancialsError("unsupported_operation", `Unsupported match kind ${kind}`);
}

function decisionId(scope: Scope, key: string): string {
  return `match_decision_${createHash("sha256")
    .update([scope.tenantId, scope.sourceId, "sdk_decision", key].join("\u0000"))
    .digest("hex")
    .slice(0, 24)}`;
}

function assertDate(value: string, field: string): asserts value is IsoDate {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ErpFinancialsError("invalid_input", `${field} must be a valid ISO date`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new ErpFinancialsError("invalid_input", `${field} must not be empty`);
}

function assertBoundedJson(value: JsonValue, field: string): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 4096) throw new ErpFinancialsError("invalid_input", `${field} exceeds 4096 bytes`);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Stored ${field} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Stored optional field must be a string");
  return value;
}

function optionalDateTime(value: unknown): IsoDateTime | undefined {
  if (value === null || value === undefined) return undefined;
  const result = value instanceof Date ? value.toISOString() : string(value, "date-time");
  if (Number.isNaN(Date.parse(result))) throw new Error("Stored date-time is invalid");
  return result;
}

function decimal(value: unknown, field: string): DecimalString {
  const result = typeof value === "number" ? String(value) : string(value, field);
  if (!/^\d+(?:\.\d+)?$/u.test(result)) throw new Error(`Stored ${field} must be a nonnegative decimal`);
  return result;
}

function parsedJson(value: unknown, field: string): JsonValue {
  const result = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (result === undefined) throw new Error(`Stored ${field} is missing`);
  return result as JsonValue;
}

function parsedOptionalJson(value: unknown): JsonValue | undefined {
  return value === null || value === undefined ? undefined : parsedJson(value, "evidence");
}

function stableJson(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const entries = value as readonly JsonValue[];
    return `[${entries.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}
