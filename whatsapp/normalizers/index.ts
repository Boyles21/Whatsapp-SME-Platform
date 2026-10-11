import { IncomingMessage, MessageType } from '../types/index.ts';

/**
 * Normalizes an official Meta WhatsApp Cloud API webhook payload into an array of IncomingMessage.
 *
 * Meta Webhook typical structure:
 * {
 *   object: 'whatsapp_business_account',
 *   entry: [{
 *     id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
 *     changes: [{
 *       value: {
 *         messaging_product: 'whatsapp',
 *         metadata: { display_phone_number: '...', phone_number_id: '...' },
 *         contacts: [{ profile: { name: 'Emeka' }, wa_id: '2348012345678' }],
 *         messages: [{
 *           from: '2348012345678',
 *           id: 'wamid.HBgL...',
 *           timestamp: '1700000000',
 *           type: 'text',
 *           text: { body: 'Sell 5 cartons of Indomie' }
 *         }]
 *       },
 *       field: 'messages'
 *     }]
 *   }]
 * }
 */
export function normalizeMetaWebhook(
  payload: any,
  fallbackBusinessId: string = 'biz_bello_01'
): IncomingMessage[] {
  const normalized: IncomingMessage[] = [];

  if (!payload || !Array.isArray(payload.entry)) {
    return normalized;
  }

  for (const entry of payload.entry) {
    if (!Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      const value = change.value;
      if (!value || !Array.isArray(value.messages)) continue;

      const metadata = value.metadata || {};
      const businessId = (fallbackBusinessId && fallbackBusinessId !== 'biz_bello_01')
        ? fallbackBusinessId
        : (metadata.phone_number_id ? `biz_wa_${metadata.phone_number_id}` : fallbackBusinessId);

      const contactsMap: Record<string, string> = {};
      if (Array.isArray(value.contacts)) {
        for (const contact of value.contacts) {
          if (contact.wa_id && contact.profile?.name) {
            contactsMap[contact.wa_id] = contact.profile.name;
          }
        }
      }

      for (const msg of value.messages) {
        let messageType: MessageType = 'TEXT';
        let textContent: string | undefined = undefined;
        let mediaUrl: string | undefined = undefined;

        switch (msg.type) {
          case 'text':
            messageType = 'TEXT';
            textContent = msg.text?.body;
            break;
          case 'image':
            messageType = 'IMAGE';
            textContent = msg.image?.caption;
            mediaUrl = msg.image?.id || msg.image?.link;
            break;
          case 'document':
            messageType = 'DOCUMENT';
            textContent = msg.document?.caption || msg.document?.filename;
            mediaUrl = msg.document?.id || msg.document?.link;
            break;
          case 'audio':
          case 'voice':
            messageType = 'AUDIO';
            mediaUrl = msg.audio?.id || msg.audio?.link || msg.voice?.id;
            break;
          default:
            messageType = 'TEXT';
            textContent = msg.text?.body;
        }

        const senderId = msg.from || 'unknown_sender';
        const senderName = contactsMap[senderId];

        normalized.push({
          messageId: msg.id || `wa_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          provider: 'whatsapp_meta',
          businessId,
          senderId,
          senderPhone: senderId,
          messageType,
          text: textContent,
          mediaUrl,
          timestamp: msg.timestamp 
            ? new Date(Number(msg.timestamp) * 1000).toISOString() 
            : new Date().toISOString(),
          metadata: {
            senderName,
            rawType: msg.type,
            phoneNumberId: metadata.phone_number_id,
          },
        });
      }
    }
  }

  return normalized;
}

/**
 * Normalizes Web Chat request into a standard IncomingMessage.
 */
export function normalizeWebChatMessage(params: {
  text: string;
  businessId: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
}): IncomingMessage {
  const now = new Date().toISOString();
  return {
    messageId: params.messageId || `web_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    provider: 'web_chat',
    businessId: params.businessId,
    senderId: params.senderId || 'web_user',
    messageType: 'TEXT',
    text: params.text,
    timestamp: now,
    metadata: {
      senderName: params.senderName || 'Merchant Web User',
      channel: 'WEB',
    },
  };
}

/**
 * Generic normalizer for testing, mocking, or other messaging providers.
 */
export function normalizeGenericMessage(params: {
  messageId?: string;
  provider?: string;
  businessId: string;
  senderId: string;
  senderPhone?: string;
  text: string;
  messageType?: MessageType;
  mediaUrl?: string;
  metadata?: Record<string, any>;
}): IncomingMessage {
  return {
    messageId: params.messageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    provider: params.provider || 'mock_whatsapp',
    businessId: params.businessId,
    senderId: params.senderId,
    senderPhone: params.senderPhone || params.senderId,
    messageType: params.messageType || 'TEXT',
    text: params.text,
    mediaUrl: params.mediaUrl,
    timestamp: new Date().toISOString(),
    metadata: params.metadata || {},
  };
}
