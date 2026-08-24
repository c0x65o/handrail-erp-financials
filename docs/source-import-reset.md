# Source-scoped import reset

`resetSourceImportState` is the clean-retry boundary for an external accounting
import. It removes ERP Financials runtime state owned by exactly one
`tenantId` / `companyId` / `sourceId` scope while preserving:

- the company, source, and company/source binding;
- reporting books, source windows, book accounts, and account mappings;
- posting rules, fiscal periods, book controls, and their lifecycle evidence;
- every other source, including a post-cutover `native_erp` source; and
- provider connection references and all host-owned OAuth or credential state.

Source accounts, parties, items, and dimensions are retired instead of deleted.
This preserves stable reporting mappings; the next import upsert reactivates the
same canonical identities. Import batches, checkpoints, ledger and subledger
facts, source projections, snapshots, rollups, freshness evidence, and source
sync markers are removed in foreign-key order.

## Host-app usage

Pass the actual PostgreSQL transaction client. The API verifies that it is
inside an explicit transaction and fails before mutation when it is not.

```ts
import { resetSourceImportState } from "@handrail/erp-financials/sdk";

const counts = await database.transaction((client) =>
  resetSourceImportState(client, {
    tenantId,
    companyId,
    sourceId: quickBooksSourceId
  })
);
```

The same operation is available from the storage adapter created for that
transaction client:

```ts
import { createPostgresStorageAdapter } from "@handrail/erp-financials";

const counts = await database.transaction((client) =>
  createPostgresStorageAdapter(client).resetSourceImportState({
    tenantId,
    companyId,
    sourceId
  })
);
```

Run the package's ordered migration chain through schema version 21 before
calling the API. The reset rejects a missing or mismatched binding, a source
shared by multiple companies, and any source identified as `native_erp` or
using the `native` provider environment. Any SQL or constraint failure aborts
the host transaction, so callers must not catch an error and commit that same
transaction.

The return value is `SanitizedSourceResetCounts`: a fixed set of numeric
operational counts capped by `SOURCE_RESET_COUNT_LIMIT`, plus `countsCapped`.
It never contains financial rows, amounts, cursors, provider payloads,
connection references, OAuth material, or credentials. Replaying a successful
reset is safe and returns zero counts.
