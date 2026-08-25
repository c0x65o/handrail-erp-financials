# BLU ERP Financials v0.3.32 release

BLU must pin the approved ERP Financials Git release exactly:

```json
{
  "dependencies": {
    "@handrail/erp-financials": "git+https://github.com/c0x65o/handrail-erp-financials.git#v0.3.32"
  }
}
```

The immutable release identity is:

| Field | Approved value |
| --- | --- |
| Package | `@handrail/erp-financials@0.3.32` |
| Git tag | `v0.3.32` |
| Commit | `be77c72d01331e8e0371a532d4569996286d1306` |
| Supported imports | `@handrail/erp-financials` and `@handrail/erp-financials/sdk` |

The publication workflow fails if a local or remote `v0.3.32` tag resolves to
any other commit. It creates the remote lightweight tag only when that ref is
absent, never force-pushes or replaces a tag, and then installs the Git tag into
a blank npm consumer. The clean-consumer check verifies package version
`0.3.32` and imports both declared package exports.

BLU should retain the tag spec in `package.json` and commit npm's resolved
commit in its lockfile. Do not replace this dependency with a copied package,
direct `src`/`dist` imports, a file link, or a BLU-local accounting fallback.
The first BLU cutover retry should run only after the tag publication workflow
has completed successfully.
