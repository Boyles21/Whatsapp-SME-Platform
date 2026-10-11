import { AIAssistantService } from './ai/index.ts';
import { ProductService, ProductResolutionResult } from './products/index.ts';
import { InventoryService } from './inventory/index.ts';
import { SalesService } from './sales/index.ts';
import { AuthService } from './auth/index.ts';
import { BusinessService } from './businesses/index.ts';
import { db } from '../db/storage.ts';
import { ChatMessage, Product } from '../types.ts';

export interface WorkflowResponse {
  message: ChatMessage;
  dashboardRefreshRequired: boolean;
}

export class WhatsAppWorkflowOrchestrator {
  public static async processIncomingMessage(
    userText: string,
    businessId: string = 'biz_default',
    actorOverride?: string
  ): Promise<WorkflowResponse> {
    const actor = actorOverride || AuthService.getCurrentUser().name;
    const business = await BusinessService.getBusiness(businessId);
    const currency = business.currencySymbol || '₦';
    const products = await ProductService.listProducts(businessId);

    // 1. AI Assistant interprets natural language message -> Structured Intent
    // (Note: The AI never touches the database!)
    const parsed = await AIAssistantService.parseMessage(userText, products);

    const now = new Date().toISOString();
    const messageId = `msg_${Date.now()}`;

    // Idempotency: only mutating transactions (ADD_STOCK, RECORD_SALE, CREATE_PRODUCT, CREATE_CUSTOMER, RECORD_PAYMENT)
    // are checked for duplicate submission to prevent double-charging or double-inventory updates.
    // Read queries (QUERY_STOCK, etc.) must always read live state.
    const isMutatingIntent = ['ADD_STOCK', 'RECORD_SALE', 'CREATE_PRODUCT', 'CREATE_CUSTOMER', 'RECORD_PAYMENT'].includes(parsed.intent);
    const idempotencyKey = `tx_${businessId}_${userText.trim().toLowerCase()}`;

    if (isMutatingIntent) {
      const cachedResponse = db.getIdempotentResult(idempotencyKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    const finalizeMutatingResponse = (resp: WorkflowResponse): WorkflowResponse => {
      db.setIdempotentResult(idempotencyKey, resp, 3000);
      return resp;
    };

    // 2. Handle CLARIFICATION or UNKNOWN
    if (parsed.intent === 'CLARIFICATION' || parsed.intent === 'UNKNOWN') {
      const replyText = parsed.parameters.clarificationPrompt || 
        'Could you please clarify your request? For example, "Add 50 cartons of Indomie at 7500 each" or "I sold 5 cartons of Indomie for 42500".';

      return {
        dashboardRefreshRequired: false,
        message: {
          id: messageId,
          sender: 'assistant',
          text: replyText,
          timestamp: now,
          status: 'read',
          structuredData: {
            type: 'CLARIFICATION_NEEDED',
            suggestedActions: [
              'Add 50 cartons of Indomie at 7500 each',
              'I sold 5 cartons of Indomie for 42500',
              'How much Indomie do I have?',
              'What did I sell today?',
              'Which products are low?',
            ],
          },
        },
      };
    }

    // 3. Handle QUERY_TODAY_SALES
    if (parsed.intent === 'QUERY_TODAY_SALES') {
      const summary = await SalesService.getTodaySales(businessId);
      
      let text = `📊 *Today's Sales Summary:*\n• *Total Revenue:* ${currency}${summary.totalRevenue.toLocaleString()}\n• *Transactions:* ${summary.totalCount}\n`;

      if (summary.itemsSummary.length > 0) {
        text += `\n*Items Sold Today:*`;
        summary.itemsSummary.forEach(item => {
          text += `\n• ${item.name}: ${item.quantity} ${item.unit}(s) — ${currency}${item.total.toLocaleString()}`;
        });
      } else {
        text += `\n_No sales recorded yet today._`;
      }

      return {
        dashboardRefreshRequired: false,
        message: {
          id: messageId,
          sender: 'assistant',
          text,
          timestamp: now,
          status: 'read',
          structuredData: {
            type: 'SALES_SUMMARY',
            todaySales: {
              total: summary.totalRevenue,
              count: summary.totalCount,
              items: summary.itemsSummary,
            },
          },
        },
      };
    }

    // 4. Handle QUERY_LOW_STOCK
    if (parsed.intent === 'QUERY_LOW_STOCK') {
      const lowStockProducts = await InventoryService.getLowStockProducts(businessId);

      if (lowStockProducts.length === 0) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `✅ *Good news!* All inventory items are currently above their minimum threshold level.`,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'LOW_STOCK_ALERT',
              products: [],
            },
          },
        };
      }

      let text = `⚠️ *Low Stock Alert (${lowStockProducts.length} items):*\n`;
      lowStockProducts.forEach(p => {
        text += `\n• *${p.name}* (ID: \`${p.id}\`): Current stock is *${p.currentStock} ${p.unit}(s)* (Min threshold: ${p.minStockLevel})`;
      });
      text += `\n\n_Reply with "Add [qty] cartons of [product]" to replenish._`;

      return {
        dashboardRefreshRequired: false,
        message: {
          id: messageId,
          sender: 'assistant',
          text,
          timestamp: now,
          status: 'read',
          structuredData: {
            type: 'LOW_STOCK_ALERT',
            products: lowStockProducts,
          },
        },
      };
    }

    // 5. Handle QUERY_STOCK
    if (parsed.intent === 'QUERY_STOCK') {
      const query = parsed.parameters.productNameQuery;

      if (!query || query.toLowerCase() === 'all' || query.toLowerCase() === 'products') {
        // Return full fresh inventory overview directly from database
        const freshProducts = await ProductService.listProducts(businessId);
        let text = `📦 *Current Stock Levels:*\n`;
        freshProducts.forEach(p => {
          const isLow = p.currentStock <= p.minStockLevel;
          text += `\n• *${p.name}*: ${p.currentStock} ${p.unit}(s) ${isLow ? '⚠️ *(LOW)*' : '✅'}`;
        });

        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'STOCK_QUERY',
              products: freshProducts,
            },
          },
        };
      }

      // Resolve product by ID or name
      const resolution = await ProductService.resolveProduct(businessId, query);

      if (resolution.status === 'AMBIGUOUS') {
        const optionsList = resolution.candidates!.map(c => `• "${c.name}" (${c.currentStock} ${c.unit}s in stock)`).join('\n');
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `I found multiple matching products for "${query}". Which one do you mean?\n\n${optionsList}\n\nPlease specify the exact product name.`,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'CLARIFICATION_NEEDED',
              suggestedActions: resolution.candidates!.map(c => `How much ${c.name} do I have?`),
            },
          },
        };
      }

      if (resolution.status === 'NOT_FOUND') {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `❌ I couldn't find "${query}" in your inventory catalog. Would you like to create it or check another product?`,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'ERROR',
              suggestedActions: ['Which products are low?', 'What did I sell today?'],
            },
          },
        };
      }

      // Read directly from authoritative InventoryService to ensure zero stale state
      const freshProduct = await InventoryService.getProductBalance(resolution.product!.id);
      const product = freshProduct || resolution.product!;
      const isLow = product.currentStock <= product.minStockLevel;
      const text = `📦 *Stock Balance:*\n\n• *Product:* ${product.name}\n• *Current Stock:* *${product.currentStock} ${product.unit}(s)* ${isLow ? '⚠️ *(LOW STOCK)*' : '✅'}\n• *SKU:* \`${product.sku}\`\n• *Selling Price:* ${currency}${product.sellingPrice.toLocaleString()}\n• *Min Level:* ${product.minStockLevel} ${product.unit}(s)`;

      return {
        dashboardRefreshRequired: false,
        message: {
          id: messageId,
          sender: 'assistant',
          text,
          timestamp: now,
          status: 'read',
          structuredData: {
            type: 'STOCK_QUERY',
            product,
          },
        },
      };
    }

    // 6. Handle ADD_STOCK
    if (parsed.intent === 'ADD_STOCK') {
      const query = parsed.parameters.productNameQuery;
      const quantity = parsed.parameters.quantity;

      if (!query || !quantity || quantity <= 0) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `Please specify the product and a positive quantity to add. Example: *"Add 50 cartons of Indomie at 7500 each"*`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'CLARIFICATION_NEEDED' },
          },
        };
      }

      // Resolve product ID
      const resolution = await ProductService.resolveProduct(businessId, query);

      if (resolution.status === 'AMBIGUOUS') {
        const optionsList = resolution.candidates!.map(c => `• "${c.name}" (ID: \`${c.id}\`)`).join('\n');
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `Multiple products match "${query}". Which product are you adding stock to?\n\n${optionsList}`,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'CLARIFICATION_NEEDED',
              suggestedActions: resolution.candidates!.map(c => `Add ${quantity} of ${c.name}`),
            },
          },
        };
      }

      if (resolution.status === 'NOT_FOUND') {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `❌ "${query}" is not found in your catalog. You can create it in the Products section or type *"create product: ${query}, unit: carton, cost: 7500, price: 8500"*.`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'ERROR' },
          },
        };
      }

      const product = resolution.product!;

      // Execute atomic backend stock-in operation (creates inventory transaction and audit log)
      try {
        const result = await InventoryService.addStock(businessId, actor, {
          productId: product.id,
          quantity,
          unitCost: parsed.parameters.unitCost,
          notes: `Added via WhatsApp chat: "${userText}"`,
        });

        const costInfo = parsed.parameters.unitCost 
          ? ` @ ${currency}${parsed.parameters.unitCost.toLocaleString()} each` 
          : '';

        const replyText = `✅ *Stock Successfully Added!*\n\n• *Product:* ${result.product.name}\n• *Added:* +${quantity} ${result.product.unit}(s)${costInfo}\n• *New Stock Balance:* *${result.product.currentStock} ${result.product.unit}(s)*\n• *Tx Ref:* \`${result.transaction.id}\`\n• *Audit Status:* Logged atomically`;

        return finalizeMutatingResponse({
          dashboardRefreshRequired: true,
          message: {
            id: messageId,
            sender: 'assistant',
            text: replyText,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'STOCK_CONFIRMATION',
              product: result.product,
              transaction: result.transaction,
            },
          },
        });
      } catch (err: any) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `❌ *Failed to add stock:* ${err.message}`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'ERROR' },
          },
        };
      }
    }

    // 7. Handle RECORD_SALE
    if (parsed.intent === 'RECORD_SALE') {
      const query = parsed.parameters.productNameQuery;
      const quantity = parsed.parameters.quantity;

      if (!query || !quantity || quantity <= 0) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `Please specify the product and quantity sold. Example: *"I sold 5 cartons of Indomie for 42500"*`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'CLARIFICATION_NEEDED' },
          },
        };
      }

      // Resolve product ID
      const resolution = await ProductService.resolveProduct(businessId, query);

      if (resolution.status === 'AMBIGUOUS') {
        const optionsList = resolution.candidates!.map(c => `• "${c.name}" (${c.currentStock} available)`).join('\n');
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `Multiple products match "${query}". Which product did you sell?\n\n${optionsList}`,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'CLARIFICATION_NEEDED',
              suggestedActions: resolution.candidates!.map(c => `I sold ${quantity} ${c.name}`),
            },
          },
        };
      }

      if (resolution.status === 'NOT_FOUND') {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `❌ "${query}" does not exist in your catalog. Please check the spelling or add it first.`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'ERROR' },
          },
        };
      }

      const product = resolution.product!;

      // Validate stock before selling (strictly enforces NEVER negative stock)
      if (product.currentStock < quantity) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `❌ *Insufficient Stock!*\n\nYou only have *${product.currentStock} ${product.unit}(s)* of "${product.name}" in stock, but tried to record a sale of *${quantity}*. Stock cannot become negative.\n\nPlease adjust the quantity or restock first.`,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'ERROR',
              product,
              suggestedActions: [
                `Add 50 cartons of ${product.name}`,
                `I sold ${product.currentStock} cartons of ${product.name}`,
              ],
            },
          },
        };
      }

      // Execute atomic sale
      try {
        const saleResult = await SalesService.recordSale(businessId, actor, {
          items: [
            {
              productId: product.id,
              quantity,
              unitPrice: parsed.parameters.unitPrice,
            },
          ],
          totalAmountOverride: parsed.parameters.totalAmount,
          customerName: parsed.parameters.customerName,
          notes: `WhatsApp Instant Sale: "${userText}"`,
        });

        const updatedProd = saleResult.updatedProducts[0];
        const isLow = updatedProd.currentStock <= updatedProd.minStockLevel;

        const replyText = `🧾 *Sale Recorded Successfully!*\n\n• *Invoice:* \`${saleResult.sale.invoiceNumber}\`\n• *Item:* ${product.name}\n• *Quantity Sold:* ${quantity} ${product.unit}(s)\n• *Total Amount:* *${currency}${(saleResult.sale.totalAmount || 0).toLocaleString()}*\n• *Remaining Stock:* *${updatedProd.currentStock} ${product.unit}(s)* ${isLow ? '⚠️ *(LOW)*' : '✅'}\n• *Audit Status:* Logged atomically`;

        return finalizeMutatingResponse({
          dashboardRefreshRequired: true,
          message: {
            id: messageId,
            sender: 'assistant',
            text: replyText,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'SALE_RECEIPT',
              sale: saleResult.sale,
              product: updatedProd,
              transaction: saleResult.inventoryTransactions[0],
            },
          },
        });
      } catch (err: any) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `❌ *Sale Transaction Rejected:* ${err.message}`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'ERROR' },
          },
        };
      }
    }

    // 8. Handle CREATE_PRODUCT
    if (parsed.intent === 'CREATE_PRODUCT') {
      const name = parsed.parameters.productNameQuery;
      const cost = parsed.parameters.costPrice || 0;
      const sell = parsed.parameters.sellingPrice || 0;
      const unit = parsed.parameters.unit || 'unit';
      const initialStock = parsed.parameters.quantity || 0;

      if (!name) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `Please specify the product name, cost price, and selling price.`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'CLARIFICATION_NEEDED' },
          },
        };
      }

      try {
        const product = await ProductService.createProduct(businessId, actor, {
          name,
          unit,
          costPrice: cost,
          sellingPrice: sell,
          initialStock,
        });

        return finalizeMutatingResponse({
          dashboardRefreshRequired: true,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `🎉 *New Product Created!*\n\n• *Name:* ${product.name}\n• *ID:* \`${product.id}\`\n• *SKU:* \`${product.sku}\`\n• *Stock:* ${product.currentStock} ${product.unit}(s)\n• *Cost:* ${currency}${product.costPrice.toLocaleString()}\n• *Selling Price:* ${currency}${product.sellingPrice.toLocaleString()}`,
            timestamp: now,
            status: 'read',
            structuredData: {
              type: 'STOCK_CONFIRMATION',
              product,
            },
          },
        });
      } catch (err: any) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: `❌ *Could not create product:* ${err.message}`,
            timestamp: now,
            status: 'read',
            structuredData: { type: 'ERROR' },
          },
        };
      }
    }

    // 9. Handle CREATE_CUSTOMER
    if (parsed.intent === 'CREATE_CUSTOMER') {
      const name = parsed.parameters.customerName;
      const phone = parsed.parameters.customerPhone;

      if (!name) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: 'Please specify the customer name.',
            timestamp: now,
            status: 'read',
            structuredData: { type: 'CLARIFICATION_NEEDED' },
          },
        };
      }

      const customer = await db.findOrCreateCustomer(businessId, name, phone);
      await db.createAuditLog({
        businessId,
        userId: actor,
        action: 'CUSTOMER_CREATED',
        entityType: 'CUSTOMER',
        entityId: customer.customerId || customer.id || name,
        metadata: { name: customer.name, phone: customer.phone },
        timestamp: now,
      });

      return finalizeMutatingResponse({
        dashboardRefreshRequired: false,
        message: {
          id: messageId,
          sender: 'assistant',
          text: `👤 *Customer Registered!*\n\n• *Name:* ${customer.name}\n• *Phone:* ${customer.phone || 'N/A'}\n• *Current Debt Balance:* ${currency}${customer.balance.toLocaleString()}`,
          timestamp: now,
          status: 'read',
          structuredData: {
            type: 'CUSTOMER_BALANCE',
            customer,
          },
        },
      });
    }

    // 10. Handle QUERY_CUSTOMER_BALANCE
    if (parsed.intent === 'QUERY_CUSTOMER_BALANCE') {
      const name = parsed.parameters.customerName || 'Customer';
      const result = await db.getCustomerBalance(businessId, name);
      const text = result.customer 
        ? `👤 *Customer Account Status:*\n\n• *Customer:* ${result.customer.name}\n• *Outstanding Debt Balance:* *${currency}${result.balance.toLocaleString()}* ${result.balance > 0 ? '⚠️ *(Unpaid Debt)*' : '✅ *(Cleared)*'}`
        : `Customer "${name}" was not found.`;

      return {
        dashboardRefreshRequired: false,
        message: {
          id: messageId,
          sender: 'assistant',
          text,
          timestamp: now,
          status: 'read',
          structuredData: {
            type: 'CUSTOMER_BALANCE',
            customer: result.customer || undefined,
          },
        },
      };
    }

    // 11. Handle RECORD_PAYMENT
    if (parsed.intent === 'RECORD_PAYMENT') {
      const name = parsed.parameters.customerName || 'Customer';
      const amount = parsed.parameters.paymentAmount || 0;
      const method = parsed.parameters.paymentMethod || 'CASH';

      if (amount <= 0) {
        return {
          dashboardRefreshRequired: false,
          message: {
            id: messageId,
            sender: 'assistant',
            text: 'Please specify a positive payment amount.',
            timestamp: now,
            status: 'read',
            structuredData: { type: 'CLARIFICATION_NEEDED' },
          },
        };
      }

      const customer = await db.findOrCreateCustomer(businessId, name);
      const custId = customer.customerId || customer.id || '';
      const payment = await db.recordPayment({
        businessId,
        customerId: custId,
        amount,
        method,
        reference: `REC-${Date.now().toString().slice(-6)}`,
        recordedBy: actor,
      });

      const updatedCust = custId ? await db.getCustomer(custId) : null;

      return finalizeMutatingResponse({
        dashboardRefreshRequired: true,
        message: {
          id: messageId,
          sender: 'assistant',
          text: `💳 *Payment Recorded!*\n\n• *Customer:* ${customer.name}\n• *Amount Paid:* *${currency}${amount.toLocaleString()}*\n• *Method:* ${method}\n• *Remaining Debt Balance:* ${currency}${(updatedCust?.balance || 0).toLocaleString()}`,
          timestamp: now,
          status: 'read',
          structuredData: {
            type: 'PAYMENT_RECEIPT',
            payment,
            customer: updatedCust || customer,
          },
        },
      });
    }

    // Fallback
    return {
      dashboardRefreshRequired: false,
      message: {
        id: messageId,
        sender: 'assistant',
        text: `I received your message. How can I help with your inventory?`,
        timestamp: now,
        status: 'read',
      },
    };
  }
}
