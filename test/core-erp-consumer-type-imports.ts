import {
  CORE_ERP_CANONICAL_REPORT_NAMES,
  buildCoreErpReportFromCanonicalReadModel,
  buildCoreErpPersistenceEvidence,
  createQuickBooksFullSyncWorker,
  createQuickBooksIncrementalSyncWorker
} from "@handrail/erp-financials";

import type {
  BuildCoreErpPersistenceEvidenceInput,
  BillPaymentDetail,
  BillPaymentLifecycleEvidence,
  CoreErpCanonicalReportGenerationRequest,
  CoreErpCanonicalReportGenerationResult,
  CoreErpCanonicalReportReadModelStorage,
  CoreErpCanonicalReportSnapshotStorage,
  CoreErpPersistenceEvidence,
  CoreErpPersistenceEvidenceCheckpointSummary,
  CoreErpPersistenceEvidenceFreshnessSummary,
  CoreErpPersistenceEvidenceSourceReferences,
  CoreErpReportDrilldownSurface,
  CoreErpReportDrilldownSurfaceEntry,
  CoreErpReportFreshness,
  CoreErpReportFreshnessRow,
  CoreErpReportName,
  CoreErpReportReconciliationDrilldownSurface,
  CoreErpReportRollupBucket,
  CoreErpTenantReadAccess,
  CustomerPaymentDetail,
  CustomerPaymentProvenance,
  GeneralLedgerDimensionProvenance,
  GeneralLedgerFilters,
  GeneralLedgerLine,
  GeneralLedgerSourceProvenance,
  InvoiceDeliveryEvent,
  PaymentApplicationDetail,
  PaymentApplicationListItem,
  PaymentStatus,
  EndSubledgerApplicationInput,
  QuickBooksFullSyncRunResult,
  QuickBooksFullSyncWorker,
  QuickBooksIncrementalSyncRunResult,
  QuickBooksIncrementalSyncWorker,
  PostedVendorBillLifecycleResult,
  PostedBillPaymentLifecycleResult,
  ReplaceIssuedVendorBillInput,
  ReplacePostedVendorBillInput,
  VendorBillApplicationReadModel,
  VendorBillDetail,
  VendorBillLineReadModel,
  VendorBillListItem,
  VendorBillSummary,
  WriteOffDetail,
  WriteOffListItem,
  ReplaceIssuedWriteOffInput,
  SettleInvoiceWriteOffInput,
  SettleInvoiceWriteOffResult,
  VoidIssuedWriteOffInput,
  VoidIssuedVendorBillInput,
  VoidIssuedBillPaymentInput,
  VoidPostedBillPaymentInput,
  VoidPostedVendorBillInput
} from "@handrail/erp-financials";

export const coreErpPersistenceEvidenceImports = {
  CORE_ERP_CANONICAL_REPORT_NAMES,
  buildCoreErpReportFromCanonicalReadModel,
  buildCoreErpPersistenceEvidence,
  createQuickBooksFullSyncWorker,
  createQuickBooksIncrementalSyncWorker
};

export const coreErpSupportedReportNames: readonly CoreErpReportName[] = [
  "profit_and_loss",
  "balance_sheet",
  "trial_balance",
  "cash_flow"
];

export type CoreErpPersistenceEvidenceImports = {
  readonly buildInput: BuildCoreErpPersistenceEvidenceInput;
  readonly evidence: CoreErpPersistenceEvidence;
  readonly checkpoint: CoreErpPersistenceEvidenceCheckpointSummary;
  readonly freshness: CoreErpPersistenceEvidenceFreshnessSummary;
  readonly sourceReferences: CoreErpPersistenceEvidenceSourceReferences;
  readonly fullSyncWorker: QuickBooksFullSyncWorker;
  readonly fullSyncRunResult: QuickBooksFullSyncRunResult;
  readonly incrementalSyncWorker: QuickBooksIncrementalSyncWorker;
  readonly incrementalSyncRunResult: QuickBooksIncrementalSyncRunResult;
  readonly supportedReportName: CoreErpReportName;
  readonly supportedReportNames: typeof CORE_ERP_CANONICAL_REPORT_NAMES;
  readonly tenantReadAccess: CoreErpTenantReadAccess;
  readonly reportReadModelStorage: CoreErpCanonicalReportReadModelStorage;
  readonly reportSnapshotStorage: CoreErpCanonicalReportSnapshotStorage;
  readonly reportGenerationRequest: CoreErpCanonicalReportGenerationRequest;
  readonly reportGenerationResult: CoreErpCanonicalReportGenerationResult;
  readonly reportFreshness: CoreErpReportFreshness;
  readonly reportFreshnessRow: CoreErpReportFreshnessRow;
  readonly reportRollupBucket: CoreErpReportRollupBucket;
  readonly drilldownSurface: CoreErpReportDrilldownSurface;
  readonly drilldownEntry: CoreErpReportDrilldownSurfaceEntry;
  readonly reconciliationDrilldownSurface: CoreErpReportReconciliationDrilldownSurface;
  readonly vendorBill: VendorBillListItem;
  readonly vendorBillDetail: VendorBillDetail;
  readonly vendorBillLine: VendorBillLineReadModel;
  readonly vendorBillApplication: VendorBillApplicationReadModel;
  readonly vendorBillSummary: VendorBillSummary;
  readonly voidPostedVendorBillInput: VoidPostedVendorBillInput;
  readonly voidIssuedVendorBillInput: VoidIssuedVendorBillInput;
  readonly replacePostedVendorBillInput: ReplacePostedVendorBillInput;
  readonly replaceIssuedVendorBillInput: ReplaceIssuedVendorBillInput;
  readonly postedVendorBillLifecycleResult: PostedVendorBillLifecycleResult;
  readonly billPayment: BillPaymentDetail;
  readonly billPaymentLifecycle: BillPaymentLifecycleEvidence;
  readonly billPaymentStatus: PaymentStatus;
  readonly voidPostedBillPaymentInput: VoidPostedBillPaymentInput;
  readonly voidIssuedBillPaymentInput: VoidIssuedBillPaymentInput;
  readonly postedBillPaymentLifecycleResult: PostedBillPaymentLifecycleResult;
  readonly invoiceDelivery: InvoiceDeliveryEvent;
  readonly customerPayment: CustomerPaymentDetail;
  readonly customerPaymentProvenance: CustomerPaymentProvenance;
  readonly generalLedgerFilters: GeneralLedgerFilters;
  readonly generalLedgerLine: GeneralLedgerLine;
  readonly generalLedgerDimension: GeneralLedgerDimensionProvenance;
  readonly generalLedgerSource: GeneralLedgerSourceProvenance;
  readonly paymentApplication: PaymentApplicationListItem;
  readonly paymentApplicationDetail: PaymentApplicationDetail;
  readonly endSubledgerApplicationInput: EndSubledgerApplicationInput;
  readonly writeOff: WriteOffListItem;
  readonly writeOffDetail: WriteOffDetail;
  readonly voidIssuedWriteOffInput: VoidIssuedWriteOffInput;
  readonly replaceIssuedWriteOffInput: ReplaceIssuedWriteOffInput;
  readonly settleInvoiceWriteOffInput: SettleInvoiceWriteOffInput;
  readonly settleInvoiceWriteOffResult: SettleInvoiceWriteOffResult;
};
