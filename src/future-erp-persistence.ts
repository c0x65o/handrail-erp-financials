export {
  createCanonicalFactPersistenceWorker as createFutureErpCanonicalFactPersistenceWorker,
  persistCanonicalFacts as persistFutureErpCanonicalFacts
} from "./canonical-fact-persistence.js";

export type {
  CanonicalFactPersistenceResult as FutureErpCanonicalFactPersistenceResult,
  CanonicalFactPersistenceStorage as FutureErpCanonicalFactPersistenceStorage,
  CanonicalFactPersistenceWorker as FutureErpCanonicalFactPersistenceWorker
} from "./canonical-fact-persistence.js";
