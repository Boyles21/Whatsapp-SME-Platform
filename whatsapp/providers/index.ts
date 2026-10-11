import { 
  WhatsAppProvider, 
  IncomingMessage, 
  OutgoingMessage 
} from '../types/index.ts';
import { normalizeMetaWebhook } from '../normalizers/index.ts';

/**
 * In-memory Mock Provider for simulation, testing, and development
 * without requiring real Meta WhatsApp API credentials.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  public readonly name = 'mock_whatsapp';
  private sentMessages: OutgoingMessage[] = [];
  private readMessageIds: Set<string> = new Set();

  public verifyWebhook(query: Record<string, any>, verifyToken: string): { isValid: boolean; challenge?: string } {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === verifyToken) {
      return { isValid: true, challenge };
    }
    return { isValid: false };
  }

  public async receiveMessage(payload: any, businessId: string = 'biz_bello_01'): Promise<IncomingMessage[] | null> {
    if (payload?.entry) {
      return normalizeMetaWebhook(payload, businessId);
    }
    if (payload?.text && payload?.senderId) {
      return [{
        messageId: payload.messageId || `mock_msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        provider: this.name,
        businessId: payload.businessId || businessId,
        senderId: payload.senderId,
        senderPhone: payload.senderPhone || payload.senderId,
        messageType: payload.messageType || 'TEXT',
        text: payload.text,
        timestamp: new Date().toISOString(),
      }];
    }
    return null;
  }

  public async sendTextMessage(
    to: string, 
    text: string, 
    options?: { replyToMessageId?: string; metadata?: Record<string, any> }
  ): Promise<{ success: boolean; messageId: string }> {
    const messageId = `out_mock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const outgoing: OutgoingMessage = {
      recipientId: to,
      recipientPhone: to,
      messageType: 'TEXT',
      text,
      replyToMessageId: options?.replyToMessageId,
      metadata: options?.metadata,
    };
    this.sentMessages.push(outgoing);
    return { success: true, messageId };
  }

  public async sendMessage(message: OutgoingMessage): Promise<{ success: boolean; messageId: string }> {
    const messageId = `out_mock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.sentMessages.push(message);
    return { success: true, messageId };
  }

  public async markMessageAsRead(messageId: string): Promise<boolean> {
    this.readMessageIds.add(messageId);
    return true;
  }

  public getSentMessages(): OutgoingMessage[] {
    return [...this.sentMessages];
  }

  public getLastSentMessage(): OutgoingMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  public clearSentMessages(): void {
    this.sentMessages = [];
    this.readMessageIds.clear();
  }

  public isMarkedRead(messageId: string): boolean {
    return this.readMessageIds.has(messageId);
  }
}

import { config } from '../../server/config.ts';

/**
 * Meta WhatsApp Cloud API Provider.
 * Ready for future production activation when WhatsApp credentials are configured.
 * Does NOT throw or crash when credentials are absent.
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  public readonly name = 'whatsapp_meta';
  private accessToken: string | null = null;
  private phoneNumberId: string | null = null;
  private businessAccountId: string | null = null;
  private verifyToken: string | null = null;

  constructor() {
    this.accessToken = config.whatsappAccessToken;
    this.phoneNumberId = config.whatsappPhoneNumberId;
    this.businessAccountId = config.whatsappBusinessAccountId;
    this.verifyToken = config.whatsappVerifyToken;
  }

  public isConfigured(): boolean {
    return Boolean(this.accessToken && this.phoneNumberId);
  }

  public getBusinessAccountId(): string | null {
    return this.businessAccountId;
  }

  public verifyWebhook(query: Record<string, any>, verifyTokenOverride?: string): { isValid: boolean; challenge?: string } {
    const expected = verifyTokenOverride || this.verifyToken || config.whatsappVerifyToken;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === expected) {
      return { isValid: true, challenge };
    }
    return { isValid: false };
  }

  public async receiveMessage(payload: any, businessId?: string): Promise<IncomingMessage[] | null> {
    return normalizeMetaWebhook(payload, businessId);
  }

  public async sendTextMessage(
    to: string, 
    text: string, 
    options?: { replyToMessageId?: string; metadata?: Record<string, any> }
  ): Promise<{ success: boolean; messageId: string }> {
    return this.sendMessage({
      recipientId: to,
      recipientPhone: to,
      messageType: 'TEXT',
      text,
      replyToMessageId: options?.replyToMessageId,
      metadata: options?.metadata,
    });
  }

  public async sendMessage(message: OutgoingMessage): Promise<{ success: boolean; messageId: string }> {
    // If credentials are not configured yet, record a stub message
    if (!this.accessToken || !this.phoneNumberId) {
      return {
        success: true,
        messageId: `stub_meta_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      };
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`;
      const body: any = {
        messaging_product: 'whatsapp',
        to: message.recipientPhone || message.recipientId,
        type: 'text',
        text: { body: message.text },
      };

      if (message.replyToMessageId) {
        body.context = { message_id: message.replyToMessageId };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn('Meta WhatsApp API send error:', errText);
        return { success: false, messageId: '' };
      }

      const data = await res.json();
      const messageId = data?.messages?.[0]?.id || `wamid_${Date.now()}`;
      return { success: true, messageId };
    } catch (err: any) {
      console.warn('Failed to send Meta WhatsApp message:', err.message || err);
      return { success: false, messageId: '' };
    }
  }

  public async markMessageAsRead(messageId: string): Promise<boolean> {
    if (!this.accessToken || !this.phoneNumberId) return true;

    try {
      const url = `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Provider Registry for managing active messaging providers.
 */
export class WhatsAppProviderRegistry {
  private static providers: Map<string, WhatsAppProvider> = new Map();
  private static defaultProviderName: string = 'mock_whatsapp';

  static {
    // Register default providers
    const mock = new MockWhatsAppProvider();
    const meta = new MetaWhatsAppProvider();
    this.registerProvider(mock);
    this.registerProvider(meta);
  }

  public static registerProvider(provider: WhatsAppProvider): void {
    this.providers.set(provider.name, provider);
  }

  public static getProvider(name?: string): WhatsAppProvider {
    const key = name || this.defaultProviderName;
    const provider = this.providers.get(key);
    if (!provider) {
      return this.providers.get('mock_whatsapp')!;
    }
    return provider;
  }

  public static setDefaultProvider(name: string): void {
    if (this.providers.has(name)) {
      this.defaultProviderName = name;
    }
  }
}
