export type WhatsAppLifecycleEvent = 
  | 'webhook_received'
  | 'webhook_rejected'
  | 'webhook_duplicate'
  | 'ai_intent_resolved'
  | 'tool_executed'
  | 'transaction_committed'
  | 'transaction_rejected'
  | 'response_sent'
  | 'processing_error';

export interface StructuredLogPayload {
  event: WhatsAppLifecycleEvent;
  messageId?: string;
  businessId?: string;
  channel?: string;
  senderPhone?: string;
  intent?: string;
  toolName?: string;
  transactionId?: string;
  invoiceNumber?: string;
  reason?: string;
  statusCode?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
  error?: string;
}

/**
 * Sanitizes phone numbers by masking middle digits to protect merchant/customer privacy.
 * Example: '2348012345678' -> '234801***5678'
 */
export function maskPhoneNumber(phone?: string): string | undefined {
  if (!phone) return undefined;
  const clean = phone.replace(/[^0-9+]/g, '');
  if (clean.length < 8) return '***';
  return clean.slice(0, 6) + '***' + clean.slice(-4);
}

/**
 * Observability logger for WhatsApp lifecycle events.
 * Outputs machine-readable structured JSON without leaking tokens, credentials, or PII.
 */
export class WhatsAppLogger {
  public static log(payload: StructuredLogPayload): void {
    const entry = {
      timestamp: new Date().toISOString(),
      service: 'whatsapp-engine',
      event: payload.event,
      businessId: payload.businessId,
      messageId: payload.messageId,
      channel: payload.channel || 'WHATSAPP',
      senderPhone: maskPhoneNumber(payload.senderPhone),
      intent: payload.intent,
      toolName: payload.toolName,
      transactionId: payload.transactionId,
      invoiceNumber: payload.invoiceNumber,
      reason: payload.reason,
      durationMs: payload.durationMs,
      metadata: payload.metadata,
      error: payload.error,
    };

    // Remove undefined fields
    const sanitizedEntry = Object.fromEntries(
      Object.entries(entry).filter(([_, v]) => v !== undefined)
    );

    if (payload.event === 'processing_error' || payload.event === 'webhook_rejected') {
      console.error(`[WHATSAPP_EVENT] ${JSON.stringify(sanitizedEntry)}`);
    } else {
      console.log(`[WHATSAPP_EVENT] ${JSON.stringify(sanitizedEntry)}`);
    }
  }
}
