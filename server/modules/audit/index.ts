import { db, IDatabaseStorage } from '../../db/storage.ts';
import { AuditLog, AuditAction } from '../../types.ts';

export class AuditService {
  public static async recordLog(
    storage: IDatabaseStorage,
    params: {
      businessId: string;
      userId?: string;
      actor?: string;
      action: AuditAction | string;
      entityType: string;
      entityId: string;
      metadata?: Record<string, any>;
      beforeState?: Record<string, any> | null;
      afterState?: Record<string, any> | null;
    }
  ): Promise<AuditLog> {
    const userId = params.userId || params.actor || 'SYSTEM';
    return storage.createAuditLog({
      businessId: params.businessId,
      userId,
      action: params.action as AuditAction,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: {
        ...(params.metadata || {}),
        beforeState: params.beforeState,
        afterState: params.afterState,
      },
      timestamp: new Date().toISOString(),
      actor: userId,
    });
  }

  public static async getAuditTrail(businessId: string, limit: number = 50): Promise<AuditLog[]> {
    return db.getAuditLogs(businessId, limit);
  }
}
