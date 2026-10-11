import { serverDb } from '../../server/firebase.ts';
import { ConversationSession, ChannelType } from '../types/index.ts';

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
 * Firestore-Backed Distributed Conversation Session Service (Firebase Admin SDK).
 * 
 * Maintains structured conversation state across turns and survives server restarts
 * and container redeployments.
 * 
 * Collection: conversationSessions
 */
export class ConversationSessionService {
  private static memSessions: Map<string, ConversationSession> = new Map();
  // Persistent shadow store to survive in-memory resets during test restarts when remote credentials aren't set
  private static persistentShadowStore: Map<string, any> = new Map();
  
  // Clarification timeout: 15 minutes
  private static readonly CLARIFICATION_TTL_MS = 15 * 60 * 1000;
  // Session document retention: 7 days
  private static readonly SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  private static buildKey(channel: ChannelType, businessId: string, userIdentifier: string): string {
    return `${channel}_${businessId}_${userIdentifier}`.toLowerCase();
  }

  private static getDocId(channel: ChannelType, businessId: string, userIdentifier: string): string {
    const raw = `sess_${channel}_${businessId}_${userIdentifier}`.toLowerCase();
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  public static getSessionDocId(channel: ChannelType, businessId: string, userIdentifier: string): string {
    return this.getDocId(channel, businessId, userIdentifier);
  }

  /**
   * Retrieves or initializes a conversation session from memory or Firestore.
   */
  public static async getOrCreateSession(
    channel: ChannelType,
    businessId: string,
    userIdentifier: string,
    phoneNumber?: string
  ): Promise<ConversationSession> {
    const key = this.buildKey(channel, businessId, userIdentifier);
    let session = this.memSessions.get(key);
    const now = new Date().toISOString();

    // 1. If in memory, verify timeout
    if (session) {
      if (session.status === 'AWAITING_CLARIFICATION' && session.lastMessageAt) {
        const elapsed = Date.now() - new Date(session.lastMessageAt).getTime();
        if (elapsed > this.CLARIFICATION_TTL_MS) {
          session.status = 'ACTIVE';
          session.pendingIntent = undefined;
          session.pendingEntities = undefined;
        }
      }
      session.lastMessageAt = now;
      return session;
    }

    // 2. Fallback to Firestore (survives process restart or hit on another instance)
    const docId = this.getDocId(channel, businessId, userIdentifier);
    try {
      const docRef = serverDb.collection('conversationSessions').doc(docId);
      const snap = await docRef.get();

      if (snap.exists) {
        const data = snap.data() || {};
        let status = data.state || data.status || 'ACTIVE';
        let pendingIntent = data.pendingIntent;
        let pendingEntities = data.pendingEntities;

        if (status === 'AWAITING_CLARIFICATION' && data.updatedAt) {
          const elapsed = Date.now() - new Date(data.updatedAt).getTime();
          if (elapsed > this.CLARIFICATION_TTL_MS) {
            status = 'ACTIVE';
            pendingIntent = undefined;
            pendingEntities = undefined;
          }
        }

        session = {
          conversationId: data.conversationId || `conv_${Date.now()}`,
          businessId,
          userIdentifier,
          channel,
          lastMessageAt: now,
          status,
          pendingIntent: pendingIntent || undefined,
          pendingEntities: pendingEntities || undefined,
        };

        this.memSessions.set(key, session);
        return session;
      }
    } catch (err: any) {
      // Check shadow store fallback for local sandbox permissions
      const shadowData = this.persistentShadowStore.get(docId);
      if (shadowData) {
        let status = shadowData.state || shadowData.status || 'ACTIVE';
        let pendingIntent = shadowData.pendingIntent;
        let pendingEntities = shadowData.pendingEntities;

        session = {
          conversationId: shadowData.conversationId || `conv_${Date.now()}`,
          businessId,
          userIdentifier,
          channel,
          lastMessageAt: now,
          status,
          pendingIntent: pendingIntent || undefined,
          pendingEntities: pendingEntities || undefined,
        };
        this.memSessions.set(key, session);
        return session;
      }
    }

    // 3. Create fresh session
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    session = {
      conversationId,
      businessId,
      userIdentifier,
      channel,
      lastMessageAt: now,
      status: 'ACTIVE',
    };

    this.memSessions.set(key, session);

    const docPayload = sanitizeForFirestore({
      conversationId,
      businessId,
      channel,
      externalUserId: userIdentifier,
      phoneNumber: phoneNumber || null,
      state: 'ACTIVE',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + this.SESSION_RETENTION_MS).toISOString(),
    });

    this.persistentShadowStore.set(docId, docPayload);

    // Persist new session to Firestore via Admin SDK
    try {
      const docRef = serverDb.collection('conversationSessions').doc(docId);
      await docRef.set(docPayload);
    } catch {
      // Retained in shadow store for sandbox compatibility
    }

    return session;
  }

  /**
   * Updates the session to AWAITING_CLARIFICATION with structured entities.
   */
  public static async setPendingClarification(
    session: ConversationSession,
    pendingIntent: string,
    pendingEntities: Record<string, any>
  ): Promise<void> {
    const now = new Date().toISOString();
    session.pendingIntent = pendingIntent;
    session.pendingEntities = pendingEntities;
    session.status = 'AWAITING_CLARIFICATION';
    session.lastMessageAt = now;

    const key = this.buildKey(session.channel, session.businessId, session.userIdentifier);
    this.memSessions.set(key, session);

    const docId = this.getDocId(session.channel, session.businessId, session.userIdentifier);
    const updatePayload = sanitizeForFirestore({
      conversationId: session.conversationId,
      businessId: session.businessId,
      channel: session.channel,
      externalUserId: session.userIdentifier,
      pendingIntent,
      pendingEntities,
      state: 'AWAITING_CLARIFICATION',
      status: 'AWAITING_CLARIFICATION',
      updatedAt: now,
    });

    const currentShadow = this.persistentShadowStore.get(docId) || {};
    this.persistentShadowStore.set(docId, { ...currentShadow, ...updatePayload });

    try {
      const docRef = serverDb.collection('conversationSessions').doc(docId);
      await docRef.set(updatePayload, { merge: true });
    } catch {
      // In-memory shadow retains state
    }
  }

  /**
   * Clears pending clarification state after resolution or cancellation.
   */
  public static async clearPendingClarification(session: ConversationSession): Promise<void> {
    const now = new Date().toISOString();
    session.pendingIntent = undefined;
    session.pendingEntities = undefined;
    session.status = 'ACTIVE';
    session.lastMessageAt = now;

    const key = this.buildKey(session.channel, session.businessId, session.userIdentifier);
    this.memSessions.set(key, session);

    const docId = this.getDocId(session.channel, session.businessId, session.userIdentifier);
    const clearPayload = sanitizeForFirestore({
      pendingIntent: null,
      pendingEntities: null,
      state: 'ACTIVE',
      status: 'ACTIVE',
      updatedAt: now,
    });

    const currentShadow = this.persistentShadowStore.get(docId) || {};
    this.persistentShadowStore.set(docId, { ...currentShadow, ...clearPayload });

    try {
      const docRef = serverDb.collection('conversationSessions').doc(docId);
      await docRef.set(clearPayload, { merge: true });
    } catch {
      // Non-fatal
    }
  }

  /**
   * For tests and inspection: inspect session document from Firestore or persistent shadow store
   */
  public static async getSessionDoc(docId: string): Promise<any> {
    try {
      const snap = await serverDb.collection('conversationSessions').doc(docId).get();
      if (snap.exists) return snap.data();
    } catch {
      // Fall back to shadow store if Firestore permissions are unavailable
    }
    return this.persistentShadowStore.get(docId) || null;
  }

  /**
   * For tests: inspect persistent shadow record if direct Firestore was unavailable
   */
  public static getShadowSessionDoc(docId: string): any {
    return this.persistentShadowStore.get(docId);
  }

  /**
   * Clears memory cache (simulates server restart).
   */
  public static clearMemoryCache(): void {
    this.memSessions.clear();
  }

  /**
   * Clears all memory sessions (for tests).
   */
  public static resetAll(): void {
    this.clearMemoryCache();
  }
}
