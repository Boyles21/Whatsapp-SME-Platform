import { 
  IncomingMessage, 
  ConversationExecutionResult, 
  ChannelType,
  OutgoingMessage
} from '../types/index.ts';
import { ConversationSessionService } from './sessionService.ts';
import { MessageIdempotencyService } from '../idempotency/index.ts';
import { WhatsAppResponseFormatter } from '../formatters/index.ts';
import { WhatsAppProviderRegistry } from '../providers/index.ts';
import { WhatsAppLogger } from '../logger.ts';
import { AIAssistantService, ParsedAssistantIntent } from '../../server/modules/ai/index.ts';
import { ProductService } from '../../server/modules/products/index.ts';
import { InventoryService } from '../../server/modules/inventory/index.ts';
import { SalesService } from '../../server/modules/sales/index.ts';
import { CustomerService } from '../../server/modules/customers/index.ts';
import { BusinessService } from '../../server/modules/businesses/index.ts';
import { db } from '../../server/db/storage.ts';

/**
 * Unified Conversation Processor.
 * Coordinates incoming normalized messages across all channels (WhatsApp, Web, etc.),
 * enforces distributed message idempotency in Firestore, manages persistent session clarifications,
 * executes validated business services atomically, and formats channel-appropriate responses.
 */
export class ConversationProcessor {
  /**
   * Main entrypoint for processing any IncomingMessage.
   */
  public static async process(incoming: IncomingMessage): Promise<ConversationExecutionResult> {
    const { messageId, businessId, senderId, text = '', provider } = incoming;
    const channel: ChannelType = provider.startsWith('whatsapp') ? 'WHATSAPP' : 'WEB';
    const trimmedText = text.trim();
    const startTime = Date.now();

    WhatsAppLogger.log({
      event: 'webhook_received',
      messageId,
      businessId,
      channel,
      senderPhone: incoming.senderPhone || senderId,
    });

    // 1. Authoritative Firestore-Backed Message Idempotency Check
    if (messageId) {
      const claim = await MessageIdempotencyService.claimMessage(messageId, businessId, provider);
      
      if (claim.status === 'DUPLICATE_COMPLETED') {
        WhatsAppLogger.log({
          event: 'webhook_duplicate',
          messageId,
          businessId,
          channel,
          reason: 'Duplicate message already completed. Returning stored response without reprocessing.',
        });
        return claim.response;
      }
      
      if (claim.status === 'DUPLICATE_PROCESSING') {
        WhatsAppLogger.log({
          event: 'webhook_duplicate',
          messageId,
          businessId,
          channel,
          reason: 'Duplicate message currently in-flight. Skipping duplicate execution.',
        });
        return {
          messageId,
          conversationId: `conv_${senderId}`,
          channel,
          intent: 'UNKNOWN',
          text: 'Message is currently being processed. Please wait a moment.',
          success: true,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          metadata: { duplicateSuppressed: true, inFlight: true },
        };
      }

      if (claim.status === 'DUPLICATE_FAILED') {
        WhatsAppLogger.log({
          event: 'webhook_duplicate',
          messageId,
          businessId,
          channel,
          reason: 'Duplicate of previously failed message.',
        });
        return {
          messageId,
          conversationId: `conv_${senderId}`,
          channel,
          intent: 'UNKNOWN',
          text: 'This message previously encountered a processing error. Please try again with a new message.',
          success: false,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          metadata: { duplicateSuppressed: true, previouslyFailed: true },
        };
      }
    }

    try {
      // 2. Retrieve or create persistent session from Firestore/memory
      const session = await ConversationSessionService.getOrCreateSession(
        channel, 
        businessId, 
        senderId, 
        incoming.senderPhone
      );
      const business = await BusinessService.getBusiness(businessId);
      const currency = business?.currencySymbol || '₦';
      const products = await ProductService.listProducts(businessId);

      let executionResult: ConversationExecutionResult;

      // 3. Check for Pending Clarification in Session
      if (session.status === 'AWAITING_CLARIFICATION' && session.pendingIntent) {
        executionResult = await this.handlePendingClarification({
          session,
          userText: trimmedText,
          businessId,
          currency,
          products,
          incoming,
        });
      } else {
        // 4. Normal Intent Interpretation via AI Assistant
        const parsed = await AIAssistantService.parseMessage(trimmedText, products);
        WhatsAppLogger.log({
          event: 'ai_intent_resolved',
          messageId,
          businessId,
          channel,
          intent: parsed.intent,
        });

        executionResult = await this.executeIntent({
          parsed,
          userText: trimmedText,
          businessId,
          currency,
          session,
          incoming,
        });
      }

      // 5. Store completed result for distributed idempotency
      if (messageId) {
        await MessageIdempotencyService.completeMessage(messageId, executionResult);
      }

      // 6. If WhatsApp provider, send outgoing message
      if (channel === 'WHATSAPP') {
        const whatsappProvider = WhatsAppProviderRegistry.getProvider(provider);
        if (whatsappProvider) {
          const outgoing: OutgoingMessage = {
            recipientId: incoming.senderPhone || senderId,
            recipientPhone: incoming.senderPhone || senderId,
            messageType: 'TEXT',
            text: executionResult.text,
            replyToMessageId: messageId,
          };
          await whatsappProvider.sendMessage(outgoing);
          await whatsappProvider.markMessageAsRead(messageId);
        }
      }

      WhatsAppLogger.log({
        event: 'response_sent',
        messageId,
        businessId,
        channel,
        durationMs: Date.now() - startTime,
      });

      return executionResult;
    } catch (err: any) {
      // Release or fail lock on error
      if (messageId) {
        await MessageIdempotencyService.failMessage(messageId, err);
      }

      WhatsAppLogger.log({
        event: 'processing_error',
        messageId,
        businessId,
        channel,
        error: err.message,
        durationMs: Date.now() - startTime,
      });

      const fallbackText = WhatsAppResponseFormatter.formatError(
        'An error occurred while processing your inventory transaction. Please try again.'
      );

      return {
        success: false,
        messageId,
        conversationId: `conv_${senderId}`,
        channel,
        text: fallbackText,
        dashboardRefreshRequired: false,
        sessionStatus: 'ACTIVE',
      };
    }
  }

  /**
   * Handles multi-turn clarification resolution when a session is awaiting specifics.
   */
  private static async handlePendingClarification(context: {
    session: any;
    userText: string;
    businessId: string;
    currency: string;
    products: any[];
    incoming: IncomingMessage;
  }): Promise<ConversationExecutionResult> {
    const { session, userText, businessId, currency, products, incoming } = context;
    const pendingIntent = session.pendingIntent;
    const pendingEntities = session.pendingEntities || {};

    // 1. Resolve RECORD_SALE clarification
    if (pendingIntent === 'RECORD_SALE') {
      const quantity = pendingEntities.quantity || 1;
      const partialQuery = pendingEntities.partialQuery || '';
      
      // Resolve product using userText (or combined with previous partial query)
      let resolved = await ProductService.resolveProduct(businessId, userText);
      if (resolved.status !== 'EXACT_MATCH' && partialQuery) {
        const combinedQuery = `${partialQuery} ${userText}`.trim();
        const combinedResolution = await ProductService.resolveProduct(businessId, combinedQuery);
        if (combinedResolution.status === 'EXACT_MATCH') {
          resolved = combinedResolution;
        }
      }

      if (resolved.status === 'AMBIGUOUS') {
        const replyText = WhatsAppResponseFormatter.formatClarification(
          `Multiple products match "${userText}". Please specify:`,
          resolved.candidates
        );
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel: session.channel,
          text: replyText,
          dashboardRefreshRequired: false,
          sessionStatus: 'AWAITING_CLARIFICATION',
        };
      }

      if (resolved.status === 'NOT_FOUND') {
        await ConversationSessionService.clearPendingClarification(session);
        const replyText = WhatsAppResponseFormatter.formatError(`"${userText}" is not found in your catalog.`);
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel: session.channel,
          text: replyText,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
        };
      }

      const product = resolved.product!;

      // Oversale check
      if (product.currentStock < quantity) {
        await ConversationSessionService.clearPendingClarification(session);
        WhatsAppLogger.log({
          event: 'transaction_rejected',
          messageId: incoming.messageId,
          businessId,
          reason: `Insufficient stock for clarified product ${product.name}`,
        });
        const replyText = WhatsAppResponseFormatter.formatError(
          `Insufficient stock. You have ${product.currentStock} ${product.unit}s in stock, but tried to sell ${quantity}.`,
          {
            productName: product.name,
            availableStock: product.currentStock,
            requestedQuantity: quantity,
            unit: product.unit,
          }
        );
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel: session.channel,
          text: replyText,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
        };
      }

      // Execute atomic sale
      const actor = incoming.metadata?.senderName || 'Store Owner';
      WhatsAppLogger.log({
        event: 'tool_executed',
        messageId: incoming.messageId,
        businessId,
        toolName: 'recordSale_clarification',
      });

      const saleResult = await SalesService.recordSale(businessId, actor, {
        items: [{ productId: product.id, quantity, unitPrice: pendingEntities.unitPrice }],
        totalAmountOverride: pendingEntities.totalAmount,
        customerName: pendingEntities.customerName,
        notes: `Clarified Instant Sale: "${userText}"`,
      });

      WhatsAppLogger.log({
        event: 'transaction_committed',
        messageId: incoming.messageId,
        businessId,
        transactionId: saleResult.sale.saleId || (saleResult.sale as any).id,
        invoiceNumber: saleResult.sale.invoiceNumber,
      });

      await ConversationSessionService.clearPendingClarification(session);

      const updatedProd = saleResult.updatedProducts[0];
      const replyText = WhatsAppResponseFormatter.formatSale({
        invoiceNumber: saleResult.sale.invoiceNumber,
        productName: product.name,
        quantity,
        unit: product.unit,
        totalAmount: saleResult.sale.totalAmount || 0,
        amountPaid: saleResult.sale.amountPaid || 0,
        balanceDue: saleResult.sale.balanceDue || 0,
        remainingStock: updatedProd.currentStock,
        customerName: saleResult.sale.customerName,
        currencySymbol: currency,
      });

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel: session.channel,
        text: replyText,
        dashboardRefreshRequired: true,
        sessionStatus: 'ACTIVE',
        intent: 'RECORD_SALE',
        data: saleResult,
      };
    }

    // 2. Resolve ADD_STOCK clarification
    if (pendingIntent === 'ADD_STOCK') {
      const quantity = pendingEntities.quantity || 1;
      const partialQuery = pendingEntities.partialQuery || '';

      let resolved = await ProductService.resolveProduct(businessId, userText);
      if (resolved.status !== 'EXACT_MATCH' && partialQuery) {
        const combinedResolution = await ProductService.resolveProduct(businessId, `${partialQuery} ${userText}`.trim());
        if (combinedResolution.status === 'EXACT_MATCH') {
          resolved = combinedResolution;
        }
      }

      if (resolved.status === 'EXACT_MATCH') {
        const product = resolved.product!;
        const actor = incoming.metadata?.senderName || 'Store Owner';
        WhatsAppLogger.log({
          event: 'tool_executed',
          messageId: incoming.messageId,
          businessId,
          toolName: 'addStock_clarification',
        });

        const result = await InventoryService.addStock(businessId, actor, {
          productId: product.id,
          quantity,
          unitCost: pendingEntities.unitCost,
          notes: `Added via clarified chat: "${userText}"`,
        });

        WhatsAppLogger.log({
          event: 'transaction_committed',
          messageId: incoming.messageId,
          businessId,
          transactionId: result.transaction.transactionId || (result.transaction as any).id,
        });

        await ConversationSessionService.clearPendingClarification(session);

        const replyText = WhatsAppResponseFormatter.formatStockAdded({
          productName: result.product.name,
          quantity,
          unit: result.product.unit,
          newStock: result.product.currentStock,
          unitCost: pendingEntities.unitCost,
          currencySymbol: currency,
        });

        return {
          success: true,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel: session.channel,
          text: replyText,
          dashboardRefreshRequired: true,
          sessionStatus: 'ACTIVE',
          intent: 'ADD_STOCK',
          data: result,
        };
      }
    }

    // Fallback: Clear pending clarification and parse afresh
    await ConversationSessionService.clearPendingClarification(session);
    const parsed = await AIAssistantService.parseMessage(userText, products);
    return this.executeIntent({
      parsed,
      userText,
      businessId,
      currency,
      session,
      incoming,
    });
  }

  /**
   * Executes a parsed intent using the validated business services.
   */
  private static async executeIntent(context: {
    parsed: ParsedAssistantIntent;
    userText: string;
    businessId: string;
    currency: string;
    session: any;
    incoming: IncomingMessage;
  }): Promise<ConversationExecutionResult> {
    const { parsed, userText, businessId, currency, session, incoming } = context;
    const actor = incoming.metadata?.senderName || 'Store Owner';
    const channel = session.channel;

    // 1. CLARIFICATION / UNKNOWN
    if (parsed.intent === 'CLARIFICATION' || parsed.intent === 'UNKNOWN') {
      const prompt = parsed.parameters.clarificationPrompt || 
        'Could you please clarify your request? For example, "Add 50 cartons of Indomie" or "I sold 5 cartons of Indomie".';
      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text: WhatsAppResponseFormatter.formatClarification(prompt),
        dashboardRefreshRequired: false,
        sessionStatus: 'ACTIVE',
        intent: parsed.intent,
      };
    }

    // 2. QUERY_STOCK
    if (parsed.intent === 'QUERY_STOCK') {
      const query = parsed.parameters.productNameQuery;
      if (!query || query.toLowerCase() === 'all' || query.toLowerCase() === 'products') {
        const freshProducts = await ProductService.listProducts(businessId);
        const text = WhatsAppResponseFormatter.formatCatalogOverview(freshProducts);
        return {
          success: true,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          intent: 'QUERY_STOCK',
          data: freshProducts,
        };
      }

      const resolution = await ProductService.resolveProduct(businessId, query);
      if (resolution.status === 'AMBIGUOUS') {
        await ConversationSessionService.setPendingClarification(session, 'QUERY_STOCK', { partialQuery: query });
        const text = WhatsAppResponseFormatter.formatClarification(
          `I found multiple matching products for "${query}". Which one do you mean?`,
          resolution.candidates
        );
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'AWAITING_CLARIFICATION',
          intent: 'QUERY_STOCK',
        };
      }

      if (resolution.status === 'NOT_FOUND') {
        const text = WhatsAppResponseFormatter.formatError(`I couldn't find "${query}" in your inventory catalog.`);
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          intent: 'QUERY_STOCK',
        };
      }

      const freshProduct = await InventoryService.getProductBalance(resolution.product!.id);
      const product = freshProduct || resolution.product!;
      const text = WhatsAppResponseFormatter.formatStockQuery({
        name: product.name,
        currentStock: product.currentStock,
        unit: product.unit,
        sellingPrice: product.sellingPrice,
        minStockLevel: product.minStockLevel,
        currencySymbol: currency,
      });

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text,
        dashboardRefreshRequired: false,
        sessionStatus: 'ACTIVE',
        intent: 'QUERY_STOCK',
        data: product,
      };
    }

    // 3. RECORD_SALE
    if (parsed.intent === 'RECORD_SALE') {
      const query = parsed.parameters.productNameQuery;
      const quantity = parsed.parameters.quantity;

      if (!query || !quantity || quantity <= 0) {
        await ConversationSessionService.setPendingClarification(session, 'RECORD_SALE', {
          ...parsed.parameters,
        });
        const prompt = 'Please specify the product and quantity sold. Example: "I sold 5 cartons of Indomie"';
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text: WhatsAppResponseFormatter.formatClarification(prompt),
          dashboardRefreshRequired: false,
          sessionStatus: 'AWAITING_CLARIFICATION',
          intent: 'RECORD_SALE',
        };
      }

      const resolution = await ProductService.resolveProduct(businessId, query);

      if (resolution.status === 'AMBIGUOUS') {
        await ConversationSessionService.setPendingClarification(session, 'RECORD_SALE', {
          ...parsed.parameters,
          partialQuery: query,
          quantity,
        });
        const text = WhatsAppResponseFormatter.formatClarification(
          `Multiple products match "${query}". Which product did you sell?`,
          resolution.candidates
        );
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'AWAITING_CLARIFICATION',
          intent: 'RECORD_SALE',
        };
      }

      if (resolution.status === 'NOT_FOUND') {
        const text = WhatsAppResponseFormatter.formatError(`"${query}" does not exist in your catalog. Please check spelling or add it first.`);
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          intent: 'RECORD_SALE',
        };
      }

      const product = resolution.product!;

      // Oversale check
      if (product.currentStock < quantity) {
        WhatsAppLogger.log({
          event: 'transaction_rejected',
          messageId: incoming.messageId,
          businessId,
          reason: `Insufficient stock for product ${product.name}. Available: ${product.currentStock}, Requested: ${quantity}`,
        });
        const text = WhatsAppResponseFormatter.formatError(
          `Insufficient stock. You only have ${product.currentStock} ${product.unit}s of "${product.name}", but tried to sell ${quantity}.`,
          {
            productName: product.name,
            availableStock: product.currentStock,
            requestedQuantity: quantity,
            unit: product.unit,
          }
        );
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          intent: 'RECORD_SALE',
        };
      }

      // Execute atomic sale
      WhatsAppLogger.log({
        event: 'tool_executed',
        messageId: incoming.messageId,
        businessId,
        toolName: 'recordSale',
      });

      const saleResult = await SalesService.recordSale(businessId, actor, {
        items: [{ productId: product.id, quantity, unitPrice: parsed.parameters.unitPrice }],
        totalAmountOverride: parsed.parameters.totalAmount,
        customerName: parsed.parameters.customerName,
        notes: `Instant Sale: "${userText}"`,
      });

      WhatsAppLogger.log({
        event: 'transaction_committed',
        messageId: incoming.messageId,
        businessId,
        transactionId: saleResult.sale.saleId || (saleResult.sale as any).id,
        invoiceNumber: saleResult.sale.invoiceNumber,
      });

      const updatedProd = saleResult.updatedProducts[0];
      const text = WhatsAppResponseFormatter.formatSale({
        invoiceNumber: saleResult.sale.invoiceNumber,
        productName: product.name,
        quantity,
        unit: product.unit,
        totalAmount: saleResult.sale.totalAmount || 0,
        amountPaid: saleResult.sale.amountPaid || 0,
        balanceDue: saleResult.sale.balanceDue || 0,
        remainingStock: updatedProd.currentStock,
        customerName: saleResult.sale.customerName,
        currencySymbol: currency,
      });

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text,
        dashboardRefreshRequired: true,
        sessionStatus: 'ACTIVE',
        intent: 'RECORD_SALE',
        data: saleResult,
      };
    }

    // 4. ADD_STOCK
    if (parsed.intent === 'ADD_STOCK') {
      const query = parsed.parameters.productNameQuery;
      const quantity = parsed.parameters.quantity;

      if (!query || !quantity || quantity <= 0) {
        await ConversationSessionService.setPendingClarification(session, 'ADD_STOCK', {
          ...parsed.parameters,
        });
        const prompt = 'Please specify the product and a positive quantity to add. Example: "Add 50 cartons of Indomie"';
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text: WhatsAppResponseFormatter.formatClarification(prompt),
          dashboardRefreshRequired: false,
          sessionStatus: 'AWAITING_CLARIFICATION',
          intent: 'ADD_STOCK',
        };
      }

      const resolution = await ProductService.resolveProduct(businessId, query);

      if (resolution.status === 'AMBIGUOUS') {
        await ConversationSessionService.setPendingClarification(session, 'ADD_STOCK', {
          ...parsed.parameters,
          partialQuery: query,
          quantity,
        });
        const text = WhatsAppResponseFormatter.formatClarification(
          `Multiple products match "${query}". Which product are you adding stock to?`,
          resolution.candidates
        );
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'AWAITING_CLARIFICATION',
          intent: 'ADD_STOCK',
        };
      }

      if (resolution.status === 'NOT_FOUND') {
        const text = WhatsAppResponseFormatter.formatError(`"${query}" is not found in your catalog.`);
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          intent: 'ADD_STOCK',
        };
      }

      const product = resolution.product!;
      WhatsAppLogger.log({
        event: 'tool_executed',
        messageId: incoming.messageId,
        businessId,
        toolName: 'addStock',
      });

      const result = await InventoryService.addStock(businessId, actor, {
        productId: product.id,
        quantity,
        unitCost: parsed.parameters.unitCost,
        notes: `Added via chat: "${userText}"`,
      });

      WhatsAppLogger.log({
        event: 'transaction_committed',
        messageId: incoming.messageId,
        businessId,
        transactionId: result.transaction.transactionId || (result.transaction as any).id,
      });

      const text = WhatsAppResponseFormatter.formatStockAdded({
        productName: result.product.name,
        quantity,
        unit: result.product.unit,
        newStock: result.product.currentStock,
        unitCost: parsed.parameters.unitCost,
        currencySymbol: currency,
      });

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text,
        dashboardRefreshRequired: true,
        sessionStatus: 'ACTIVE',
        intent: 'ADD_STOCK',
        data: result,
      };
    }

    // 5. QUERY_TODAY_SALES
    if (parsed.intent === 'QUERY_TODAY_SALES') {
      const summary = await SalesService.getTodaySales(businessId);
      const text = WhatsAppResponseFormatter.formatTodaySales({
        totalRevenue: summary.totalRevenue,
        totalCount: summary.totalCount,
        currencySymbol: currency,
        itemsSummary: summary.itemsSummary,
      });

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text,
        dashboardRefreshRequired: false,
        sessionStatus: 'ACTIVE',
        intent: 'QUERY_TODAY_SALES',
        data: summary,
      };
    }

    // 6. QUERY_LOW_STOCK
    if (parsed.intent === 'QUERY_LOW_STOCK') {
      const lowStockProducts = await InventoryService.getLowStockProducts(businessId);
      const text = WhatsAppResponseFormatter.formatLowStock(lowStockProducts);

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text,
        dashboardRefreshRequired: false,
        sessionStatus: 'ACTIVE',
        intent: 'QUERY_LOW_STOCK',
        data: lowStockProducts,
      };
    }

    // 7. RECORD_PAYMENT
    if (parsed.intent === 'RECORD_PAYMENT') {
      const name = parsed.parameters.customerName || 'Customer';
      const amount = parsed.parameters.paymentAmount || 0;
      const method = parsed.parameters.paymentMethod || 'CASH';

      if (amount <= 0) {
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text: WhatsAppResponseFormatter.formatError('Please specify a positive payment amount.'),
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          intent: 'RECORD_PAYMENT',
        };
      }

      WhatsAppLogger.log({
        event: 'tool_executed',
        messageId: incoming.messageId,
        businessId,
        toolName: 'recordCustomerPayment',
      });

      const paymentResult = await CustomerService.recordCustomerPayment(businessId, actor, {
        customerNameOrId: name,
        amount,
        method,
      });

      WhatsAppLogger.log({
        event: 'transaction_committed',
        messageId: incoming.messageId,
        businessId,
        transactionId: paymentResult.payment.paymentId || (paymentResult.payment as any).id,
      });

      const text = WhatsAppResponseFormatter.formatPayment({
        customerName: paymentResult.customer.name,
        amountPaid: amount,
        remainingBalance: paymentResult.customer.balance,
        currencySymbol: currency,
      });

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text,
        dashboardRefreshRequired: true,
        sessionStatus: 'ACTIVE',
        intent: 'RECORD_PAYMENT',
        data: paymentResult,
      };
    }

    // 8. QUERY_CUSTOMER_BALANCE
    if (parsed.intent === 'QUERY_CUSTOMER_BALANCE') {
      const name = parsed.parameters.customerName || 'Customer';
      const result = await db.getCustomerBalance(businessId, name);

      if (!result.customer) {
        const text = WhatsAppResponseFormatter.formatError(`Customer "${name}" was not found.`);
        return {
          success: false,
          messageId: incoming.messageId,
          conversationId: session.conversationId,
          channel,
          text,
          dashboardRefreshRequired: false,
          sessionStatus: 'ACTIVE',
          intent: 'QUERY_CUSTOMER_BALANCE',
        };
      }

      const text = WhatsAppResponseFormatter.formatCustomerBalance({
        customerName: result.customer.name,
        balance: result.balance,
        currencySymbol: currency,
      });

      return {
        success: true,
        messageId: incoming.messageId,
        conversationId: session.conversationId,
        channel,
        text,
        dashboardRefreshRequired: false,
        sessionStatus: 'ACTIVE',
        intent: 'QUERY_CUSTOMER_BALANCE',
        data: result,
      };
    }

    // Fallback
    return {
      success: true,
      messageId: incoming.messageId,
      conversationId: session.conversationId,
      channel,
      text: 'I received your message. How can I help with your inventory?',
      dashboardRefreshRequired: false,
      sessionStatus: 'ACTIVE',
    };
  }
}
