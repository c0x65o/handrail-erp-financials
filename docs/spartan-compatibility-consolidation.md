# Spartan compatibility consolidation

ERP Financials 0.3.27 absorbs the reusable behavior that Spartan previously
installed by rewriting `node_modules` after package installation. Consumers now
use the normal public SDK; no postinstall mutation is required.

## Ownership inventory

| Previous patch behavior | Owner after consolidation |
| --- | --- |
| Canonical company upsert when native and QuickBooks sources share a company | ERP Financials (already present in 0.3.26 source and retained) |
| Bounded/chunked PostgreSQL upserts below the node-postgres Bind limit | ERP Financials (already present in 0.3.26 source and retained) |
| Historical transaction parties absent from current Customer/Vendor masters | ERP Financials source adapter (already present in 0.3.26) |
| Reference-only normalized batches with no ledger transactions | ERP Financials source adapter (already present in 0.3.26) |
| Provider trial-balance account totals surviving normalized-envelope adaptation | ERP Financials provider-report adapter (already present in 0.3.26) |
| Raw QuickBooks transaction-line preference with a ledger fallback for header-only operational documents | ERP Financials source adapter (already present in 0.3.26) |
| Provider-authoritative open balances plus auditable linked applications | ERP Financials QuickBooks subledger import (already present in 0.3.26) |
| Staged batch reuse, full-sync replacement, provider-ledger reconciliation, and atomic report-parity acceptance | ERP Financials and the connector's stable batch contract (already present) |
| Vendor bill splits, line customer allocations, bill-payment applications, and paid/open status | ERP Financials canonical subledger import/read models (already present) |
| Provider payload normalization | QuickBooks connector (already present in 0.1.96; no Spartan-specific change required) |
| Latest `INV-n` sequence across drafts and posted invoices | ERP Financials public read model |
| Bounded payment-history party lookup | ERP Financials public read model |
| Bounded open-invoice lookup and batched invoice details | ERP Financials public read models |
| Adjustment register, lifecycle totals, applied-invoice labels, and keyset navigation | ERP Financials public read model |
| Customer-payment register, canonical application evidence, authoritative open balances, totals, filters, sorting, and keyset navigation | ERP Financials public read model |
| Adjustment posting description/account mapping correction | ERP Financials |
| Signed A/R aging including unapplied payments and credits | ERP Financials; offsets age by document date |
| Spartan customer/payment-link display fallbacks, deposit state, bank-feed evidence, URLs, and HTTP cursor envelope | Spartan application composition after the canonical page is selected |

The reusable package never references the `spartan` schema. Every query is
bounded by tenant, company, reporting book, source membership, and currency.
Invalid boundaries and oversized batches fail closed before querying.

## Upgrade contract

1. Publish ERP Financials 0.3.27 from the validated source.
2. Upgrade the application dependency to that immutable release.
3. Remove the application patch script and install/build/test hooks that invoke it.
4. Deploy the reusable package before or together with the consuming application.

No database purge is required: this release changes supported read APIs and
query behavior, not the canonical schema or stored data format.
