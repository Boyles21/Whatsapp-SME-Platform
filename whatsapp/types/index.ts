/**
 * Normalized types and interfaces for the WhatsApp messaging adapter layer.
 */

export type MessageType = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO';

export type ChannelType = 'WHATSAPP' | 'WEB' | 'SMS' | 'OTHER';

export type ConversationStatus = 'ACTIVE' | 'AWAITING_CLARIFICATION' | 'CLOSED';

/**
 * Normalized incoming message representation.
 * Core business services only interact with this model, regardless of provider or channel.
 */
export interface IncomingMessage {
  messageId: string;
  provider: string;
  businessId: string;
  senderId: string;
  senderPhone?: string;
  messageType: MessageType;
  text?: string;
  mediaUrl?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Normalized outgoing message representation.
 */
export interface OutgoingMessage {
  recipientId: string;
  recipientPhone?: string;
  messageType: MessageType;
  text: string;
  mediaUrl?: string;
  replyToMessageId?: string;
  metadata?: Record<string, any>;
}

/**
 * Structured conversation session tracking pending state and clarifications.
 * Does not store arbitrary AI reasoning, only structured state necessary to continue interaction.
 */
export interface ConversationSession {
  conversationId: string;
  businessId: string;
  userIdentifier: string;
  channel: ChannelType;
  lastMessageAt: string;
  pendingIntent?: string;
  pendingEntities?: Record<string, any>;
  status: ConversationStatus;
}

/**
 * Provider-agnostic WhatsApp Provider interface.
 */
export interface WhatsAppProvider {
  readonly name: string;

  /**
   * Validates webhook registration challenge (e.g. Meta verification token).
   */
  verifyWebhook(query: Record<string, any>, verifyToken: string): { isValid: boolean; challenge?: string };

  /**
   * Normalizes raw webhook payload into IncomingMessage array.
   */
  receiveMessage(payload: any, businessId?: string): Promise<IncomingMessage[] | null>;

  /**
   * Sends a simple text message.
   */
  sendTextMessage(to: string, text: string, options?: { replyToMessageId?: string; metadata?: Record<string, any> }): Promise<{ success: boolean; messageId: string }>;

  /**
   * Sends a normalized outgoing message.
   */
  sendMessage(message: OutgoingMessage): Promise<{ success: boolean; messageId: string }>;

  /**
   * Marks incoming message as read.
   */
  markMessageAsRead(messageId: string): Promise<boolean>;
}

/**
 * Unified execution result returned by the conversation engine.
 */
export interface ConversationExecutionResult {
  success: boolean;
  messageId: string;
  conversationId: string;
  channel: ChannelType;
  text: string;
  dashboardRefreshRequired: boolean;
  sessionStatus: ConversationStatus;
  intent?: string;
  data?: any;
  error?: string;
  structuredData?: any;
  metadata?: Record<string, any>;
}
