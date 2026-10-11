import { IDatabaseStorage, InMemoryDatabase } from './inMemoryStorage.ts';
import { firestoreDb } from './firestoreStorage.ts';

export type { IDatabaseStorage };
export { InMemoryDatabase };

// Authoritative Firestore Database instance
export const db: IDatabaseStorage = firestoreDb;
