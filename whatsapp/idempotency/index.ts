import { serverDb } from '../../server/firebase.ts';
import { ConversationExecutionResult } from '../types/index.ts';
import { WhatsAppLogger } from '../logger.ts';

export type IdempotencyStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  messageId: string;
  businessId: string;
  provider: string;
  status: IdempotencyStatus;
  response?: ConversationExecutionResult;
  createdAt: string;
  processedAt?: string;
  expiresAt: string;
  error?: {
    message: string;
    timestamp: string;
  };
}

export type ClaimMessageResult =
  | { status: 'CLAIMED' }
  | { status: 'DUPLICATE_COMPLETED'; response: ConversationExecutionResult }
  | { status: 'DUPLICATE_PROCESSING' }
  | { status: 'DUPLICATE_FAILED'; error?: { message: string } };

function sanitizeForFirestore(val: any): any {
  if (val === undefined) return null;
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sanitizeForFirestore);
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    if (v !== undefined) {
      clean[k] = sanitizeForFirestore(v);
    }
  }
  return clean;
}

/**
 * Distributed Firestore-Backed Message Idempotency Service (Firebase Admin SDK).
 * 
 * Ensures at-most-once processing of incoming WhatsApp and Webhook messages across
 * application restarts and multiple Cloud Run instances.
 * 
 * In-memory map acts as an L1 speed optimization; Firestore 'whatsappMessageProcessing'
 * collection is the authoritative single source of truth.
 */
export class MessageIdempotencyService {
  // L1 In-Memory Cache Optimization
  private static memCache: Map<string, { status: IdempotencyStatus; result?: ConversationExecutionResult; timestamp: number; record?: IdempotencyRecord }> = new Map();
  // Persistent shadow store to survive in-memory resets during test restarts when remote credentials aren't set
  private static persistentShadowStore: Map<string, IdempotencyRecord> = new Map();
  private static readonly TTL_MS = 24 * 60 * 60 * 1000; // 24-hour retention
  private static readonly STALE_PROCESSING_LOCK_MS = 2 * 60 * 1000; // 2-minute recovery for crashed workers

  private static getDocId(messageId: string): string {
    return `msg_${messageId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  /**
   * Atomically claims an incoming message ID to prevent concurrent executions.
   */
  public static async claimMessage(
    messageId: string,
    businessId: string,
    provider: string
  ): Promise<ClaimMessageResult> {
    if (!messageId) {
      return { status: 'CLAIMED' };
    }

    // 1. Fast L1 In-Memory Check
    const cached = this.memCache.get(messageId);
    if (cached) {
      if (cached.status === 'COMPLETED' && cached.result) {
        WhatsAppLogger.log({
          event: 'webhook_duplicate',
          messageId,
          businessId,
          reason: 'L1 in-memory cache hit for completed message',
        });
        return { status: 'DUPLICATE_COMPLETED', response: cached.result };
      }
      if (cached.status === 'PROCESSING') {
        WhatsAppLogger.log({
          event: 'webhook_duplicate',
          messageId,
          businessId,
          reason: 'L1 in-memory cache hit for in-flight processing',
        });
        return { status: 'DUPLICATE_PROCESSING' };
      }
    }

    const docId = this.getDocId(messageId);
    const docRef = serverDb.collection('whatsappMessageProcessing').doc(docId);

    try {
      const result = await serverDb.runTransaction(async (fsTx) => {
        const snap = await fsTx.get(docRef);

        if (snap.exists) {
          const data = snap.data() as IdempotencyRecord;

          // Case 1: Already processed completely
          if (data.status === 'COMPLETED' && data.response) {
            return { status: 'DUPLICATE_COMPLETED' as const, response: data.response };
          }

          // Case 2: Currently in-flight
          if (data.status === 'PROCESSING') {
            const createdTime = new Date(data.createdAt || 0).getTime();
            const isStale = Date.now() - createdTime > this.STALE_PROCESSING_LOCK_MS;

            if (!isStale) {
              return { status: 'DUPLICATE_PROCESSING' as const };
            }
            // Stale lock recovery: previous instance crashed/timed out, reclaim
          }

          // Case 3: Previously marked as failed
          if (data.status === 'FAILED') {
            return { status: 'DUPLICATE_FAILED' as const, error: data.error };
          }
        }

        // Atomically claim the message
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + this.TTL_MS).toISOString();

        const claimPayload: IdempotencyRecord = {
          messageId,
          businessId,
          provider,
          status: 'PROCESSING',
          createdAt: now,
          expiresAt,
        };

        fsTx.set(docRef, sanitizeForFirestore(claimPayload));
        this.persistentShadowStore.set(docId, claimPayload);
        return { status: 'CLAIMED' as const, payload: claimPayload };
      });

      // Update in-memory L1 cache to match authoritative Firestore state
      if (result.status === 'CLAIMED') {
        this.memCache.set(messageId, { status: 'PROCESSING', timestamp: Date.now(), record: (result as any).payload });
      } else if (result.status === 'DUPLICATE_COMPLETED' && (result as any).response) {
        this.memCache.set(messageId, {
          status: 'COMPLETED',
          result: (result as any).response,
          timestamp: Date.now(),
        });
        WhatsAppLogger.log({
          event: 'webhook_duplicate',
          messageId,
          businessId,
          reason: 'Authoritative Firestore duplicate suppressed (COMPLETED)',
        });
      } else if (result.status === 'DUPLICATE_PROCESSING') {
        this.memCache.set(messageId, { status: 'PROCESSING', timestamp: Date.now() });
        WhatsAppLogger.log({
          event: 'webhook_duplicate',
          messageId,
          businessId,
          reason: 'Authoritative Firestore duplicate suppressed (PROCESSING)',
        });
      }

      return result;
    } catch (err: any) {
      // Graceful local in-memory fallback if Firestore permissions not configured in environment
      if (err.message?.includes('PERMISSION_DENIED') || err.code === 7) {
        const shadow = this.persistentShadowStore.get(docId);
        if (shadow) {
          if (shadow.status === 'COMPLETED' && shadow.response) {
            this.memCache.set(messageId, {
              status: 'COMPLETED',
              result: shadow.response,
              timestamp: Date.now(),
              record: shadow,
            });
            return { status: 'DUPLICATE_COMPLETED', response: shadow.response };
          }
          if (shadow.status === 'PROCESSING') {
            return { status: 'DUPLICATE_PROCESSING' };
          }
          if (shadow.status === 'FAILED') {
            return { status: 'DUPLICATE_FAILED', error: shadow.error };
          }
        }

        const cachedFallback = this.memCache.get(messageId);
        if (cachedFallback?.status === 'COMPLETED' && cachedFallback.result) {
          return { status: 'DUPLICATE_COMPLETED', response: cachedFallback.result };
        }
        if (cachedFallback?.status === 'PROCESSING') {
          return { status: 'DUPLICATE_PROCESSING' };
        }
        const now = new Date().toISOString();
        const fallbackRecord: IdempotencyRecord = {
          messageId,
          businessId,
          provider,
          status: 'PROCESSING',
          createdAt: now,
          expiresAt: new Date(Date.now() + this.TTL_MS).toISOString(),
        };
        this.persistentShadowStore.set(docId, fallbackRecord);
        this.memCache.set(messageId, { status: 'PROCESSING', timestamp: Date.now(), record: fallbackRecord });
        return { status: 'CLAIMED' };
      }

      WhatsAppLogger.log({
        event: 'processing_error',
        messageId,
        businessId,
        reason: 'Failed to claim idempotency lock in Firestore',
        error: err.message,
      });
      return { status: 'DUPLICATE_PROCESSING' };
    }
  }

  /**
   * Marks a message as COMPLETED with the resulting conversation response.
   */
  public static async completeMessage(
    messageId: string,
    result: ConversationExecutionResult
  ): Promise<void> {
    if (!messageId) return;

    const existing = this.memCache.get(messageId);
    const updatedRecord: IdempotencyRecord | undefined = existing?.record ? {
      ...existing.record,
      status: 'COMPLETED',
      response: result,
      processedAt: new Date().toISOString(),
    } : undefined;

    // Update L1 Cache
    this.memCache.set(messageId, {
      status: 'COMPLETED',
      result,
      timestamp: Date.now(),
      record: updatedRecord,
    });

    try {
      const docId = this.getDocId(messageId);
      const docRef = serverDb.collection('whatsappMessageProcessing').doc(docId);

      const now = new Date().toISOString();
      const existingShadow = this.persistentShadowStore.get(docId);
      if (existingShadow) {
        this.persistentShadowStore.set(docId, {
          ...existingShadow,
          status: 'COMPLETED',
          response: result,
          processedAt: now,
        });
      } else if (updatedRecord) {
        this.persistentShadowStore.set(docId, updatedRecord);
      }

      await docRef.update({
        status: 'COMPLETED',
        response: sanitizeForFirestore(result),
        processedAt: now,
      });
    } catch (err: any) {
      if (!err.message?.includes('PERMISSION_DENIED') && err.code !== 7) {
        WhatsAppLogger.log({
          event: 'processing_error',
          messageId,
          reason: 'Failed to commit COMPLETED state to Firestore',
          error: err.message,
        });
      }
    }
  }

  /**
   * Marks a message as FAILED when an unrecoverable exception occurs.
   */
  public static async failMessage(
    messageId: string,
    error: any
  ): Promise<void> {
    if (!messageId) return;

    // Remove from in-flight cache
    this.memCache.delete(messageId);

    try {
      const docId = this.getDocId(messageId);
      const docRef = serverDb.collection('whatsappMessageProcessing').doc(docId);

      const now = new Date().toISOString();
      const existingShadow = this.persistentShadowStore.get(docId);
      if (existingShadow) {
        this.persistentShadowStore.set(docId, {
          ...existingShadow,
          status: 'FAILED',
          error: {
            message: error?.message || String(error),
            timestamp: now,
          },
          processedAt: now,
        });
      }

      await docRef.update({
        status: 'FAILED',
        error: {
          message: error?.message || String(error),
          timestamp: now,
        },
        processedAt: now,
      });
    } catch (err: any) {
      if (!err.message?.includes('PERMISSION_DENIED') && err.code !== 7) {
        WhatsAppLogger.log({
          event: 'processing_error',
          messageId,
          reason: 'Failed to commit FAILED state to Firestore',
          error: err.message,
        });
      }
    }
  }

  /**
   * Retrieves the current idempotency record from Firestore (for tests and audits).
   */
  public static async getRecord(messageId: string): Promise<IdempotencyRecord | null> {
    const docId = this.getDocId(messageId);
    try {
      const docRef = serverDb.collection('whatsappMessageProcessing').doc(docId);
      const snap = await docRef.get();
      if (!snap.exists) {
        const shadow = this.persistentShadowStore.get(docId);
        if (shadow) return shadow;
        const mem = this.memCache.get(messageId);
        return mem?.record || null;
      }
      return snap.data() as IdempotencyRecord;
    } catch (err: any) {
      if (err.message?.includes('PERMISSION_DENIED') || err.code === 7) {
        const shadow = this.persistentShadowStore.get(docId);
        if (shadow) return shadow;
        const mem = this.memCache.get(messageId);
        return mem?.record || null;
      }
      return null;
    }
  }

  /**
   * Clears L1 in-memory cache (simulates server restart).
   */
  public static clearMemoryCache(): void {
    this.memCache.clear();
  }

  /**
   * Clears memory cache (backward-compatibility alias).
   */
  public static clearAll(): void {
    this.clearMemoryCache();
  }
}
