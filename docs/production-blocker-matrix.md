# Production Blocker Matrix

This matrix records unresolved production-readiness blockers for the current
Owner Goal phase. It is intentionally separate from source validation evidence:
the package can be green locally while live credentials, production data,
deploys, runtime registration, and Handrail platform capabilities remain gated.

Do not model any row below as a Codex source task unless the requested work is
limited to repo-owned docs, tests, fixtures, or package code. Anything requiring
owner approval, provider credentials, deployment, runtime configuration, queue
mutation, or Handrail platform configuration must stay a sidecar blocker or a
typed configuration request.

## Current Matrix

| Blocker | Current repo-level evidence | Required owner/platform input | Why it is not a Codex source task | Allowed repo work | Forbidden action in this phase |
| --- | --- | --- | --- | --- | --- |
| Live QuickBooks credentials | ERP Financials source validation uses deterministic normalized QuickBooks fixtures and the Handrail QuickBooks SDK/service boundary. No Intuit OAuth, refresh token, access token, client secret, API credential, or raw provider payload is required or stored by this package. | Owner-approved QuickBooks capability/provider credential configuration in the owning runtime, with secrets managed outside this repo. | Provider credentials require owner approval and secret custody in Handrail/platform systems, not a package commit. | Document env/capability expectations, validate credential fields are absent from package evidence, and keep SDK/service-shaped contracts token-free. | Add Intuit secrets to source, invent new QuickBooks env vars, call live Intuit APIs from validation, or move OAuth/token custody into ERP Financials or Future ERP. |
| Production data | Tests and replay evidence use package fixtures, sandbox-shaped ids, bounded provider report refs, and deterministic hashes. No customer ledger, production realm, or production report body is included. | Owner-approved production tenant/company/source selection and data-access scope. | Production data access is an operational/data-governance decision and cannot be satisfied by changing source files. | Keep fixture smoke, replay summaries, row-count evidence, freshness checks, and raw-payload exclusion tests reproducible. | Import, snapshot, copy, redact, or summarize live customer accounting data without an approved production data path. |
| Staging and production deploy/config changes | The active project has no Kubernetes deploy targets configured for this package, and repo validation does not require a running production workload. | Explicit owner/platform approval for deploy target creation or updates, runtime env changes, promotion, or release. | Deploy and runtime config mutate Handrail/platform state outside the repository and are disabled for this work request. | Keep Docker/runtime assumptions out of package docs unless an authorized deploy target exists; document commands that can be run locally. | Deploy, promote, create deploy targets, change runtime env, rotate secrets, or assume a container port/health path not declared by Handrail. |
| Scheduler/runtime registration | `future_erp.erp_financials.*` job names, retry keys, package APIs, and evidence fields are documented as host-callable contracts only. | Owner-approved scheduler, queue, cron, or runtime registration in the host app or Handrail platform. | Registering jobs changes managed runtime behavior and may affect production cadence/data processing. | Maintain source-level job descriptors, worker helpers, retry-safe inputs, fixture smoke, and handoff docs. | Register queues, create cron entries, mutate scheduler state, change runtime cadence, or treat a documented job name as already deployed. |
| Formal `erp_financials` capability creation | `handrail-capability-plan.md` describes a future capability contract, but the active ERP Financials context has no configured `erp_financials` capability. | Owner decision and Handrail platform configuration to create/enable the capability, including scope, generated env, install validation, and scheduler hooks. | Capability creation is platform configuration, not package implementation. The owner goal explicitly requires an owner decision before creating it. | Keep package APIs, install health, schema manifest, fixture smoke, freshness/drilldown checks, and capability docs ready for a later configuration request. | Create or register the capability, generate platform env, mutate capability rows, or request the already-rejected stale Future ERP repo authorization path. |

## Closeout Rule

Green source validation may close repo-owned tasks only. A production-readiness
claim must cite any unresolved rows above as external blockers until the
corresponding owner-approved credential, data, deploy, scheduler, or capability
configuration work is completed through the appropriate Handrail mechanism.
