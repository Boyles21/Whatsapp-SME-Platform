import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { Product } from '../../types.ts';

export interface ParsedAssistantIntent {
  intent: 
    | 'ADD_STOCK' 
    | 'RECORD_SALE' 
    | 'QUERY_STOCK' 
    | 'QUERY_TODAY_SALES' 
    | 'QUERY_LOW_STOCK' 
    | 'CREATE_PRODUCT' 
    | 'CREATE_CUSTOMER'
    | 'QUERY_CUSTOMER_BALANCE'
    | 'RECORD_PAYMENT'
    | 'CLARIFICATION' 
    | 'UNKNOWN';
  functionCalled?: string;
  confidence: number;
  parameters: {
    productNameQuery?: string;
    productId?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    totalAmount?: number;
    customerName?: string;
    customerPhone?: string;
    unitCost?: number;
    minStockLevel?: number;
    costPrice?: number;
    sellingPrice?: number;
    paymentAmount?: number;
    paymentMethod?: string;
    paymentReference?: string;
    clarificationPrompt?: string;
  };
  reasoning?: string;
}

// Function Declarations for Gemini
const inventoryTools: FunctionDeclaration[] = [
  {
    name: 'createProduct',
    description: 'Create a brand new product in the store catalog.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Product name' },
        unit: { type: Type.STRING, description: 'Unit of measurement (carton, pack, bag, tin)' },
        costPrice: { type: Type.NUMBER, description: 'Cost price per unit' },
        sellingPrice: { type: Type.NUMBER, description: 'Selling price per unit' },
        minStockLevel: { type: Type.NUMBER, description: 'Minimum stock alert threshold' },
        initialStock: { type: Type.NUMBER, description: 'Initial stock on hand' },
      },
      required: ['name', 'costPrice', 'sellingPrice'],
    },
  },
  {
    name: 'addStock',
    description: 'Add new incoming stock to inventory for an existing product.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productNameQuery: {
          type: Type.STRING,
          description: 'The product name or keyword (e.g. "Indomie", "Golden Penny", "Sugar").',
        },
        quantity: {
          type: Type.NUMBER,
          description: 'The quantity of items to add (positive number).',
        },
        unitCost: {
          type: Type.NUMBER,
          description: 'Optional cost price per unit if mentioned (e.g. 7500).',
        },
        unit: {
          type: Type.STRING,
          description: 'Optional unit of measurement (e.g. "carton", "pack", "bag").',
        },
      },
      required: ['productNameQuery', 'quantity'],
    },
  },
  {
    name: 'getStock',
    description: 'Check current inventory level / stock quantity for a specific product or general catalog.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productNameQuery: {
          type: Type.STRING,
          description: 'Product name to query (e.g. "Indomie"). Leave blank if asking for all products.',
        },
      },
    },
  },
  {
    name: 'recordSale',
    description: 'Record a sale transaction of products to a customer.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productNameQuery: {
          type: Type.STRING,
          description: 'The product name or keyword (e.g. "Indomie").',
        },
        quantity: {
          type: Type.NUMBER,
          description: 'The quantity of items sold (positive number).',
        },
        unitPrice: {
          type: Type.NUMBER,
          description: 'Selling price per unit if specified.',
        },
        totalAmount: {
          type: Type.NUMBER,
          description: 'Total revenue or lump sum amount paid (e.g. 42500).',
        },
        customerName: {
          type: Type.STRING,
          description: 'Customer name if mentioned in the message.',
        },
        unit: {
          type: Type.STRING,
          description: 'Unit of measurement (e.g. carton, bag).',
        },
      },
      required: ['productNameQuery', 'quantity'],
    },
  },
  {
    name: 'getSales',
    description: 'Get total sales, revenue, and items sold today or recent period.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        period: {
          type: Type.STRING,
          description: '"today" or "recent"',
        },
      },
    },
  },
  {
    name: 'getLowStock',
    description: 'List all products that have reached or dropped below their minimum reorder stock level.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'createCustomer',
    description: 'Register a new customer with their name and optional phone number.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Customer name' },
        phone: { type: Type.STRING, description: 'Customer phone number' },
      },
      required: ['name'],
    },
  },
  {
    name: 'getCustomerBalance',
    description: 'Check outstanding debt or account balance for a customer.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Customer name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'recordPayment',
    description: 'Record a customer debt or invoice payment received.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        customerName: { type: Type.STRING, description: 'Customer name' },
        amount: { type: Type.NUMBER, description: 'Amount received' },
        paymentMethod: { type: Type.STRING, description: 'CASH, TRANSFER, POS' },
        reference: { type: Type.STRING, description: 'Receipt note or reference' },
      },
      required: ['customerName', 'amount'],
    },
  },
  {
    name: 'askClarification',
    description: 'Triggered when the user request is ambiguous, incomplete, missing essential quantity/product, or unclear.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'Why clarification is needed' },
        questionToUser: { type: Type.STRING, description: 'The question to ask the user to clarify' },
      },
      required: ['reason', 'questionToUser'],
    },
  },
];

export class AIAssistantService {
  private static circuitBreakerUntil: number = 0;

  private static getGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  public static async parseMessage(
    userMessage: string, 
    availableProducts: Product[]
  ): Promise<ParsedAssistantIntent> {
    const trimmed = userMessage.trim();
    if (!trimmed) {
      return {
        intent: 'CLARIFICATION',
        functionCalled: 'askClarification',
        confidence: 1.0,
        parameters: { clarificationPrompt: 'Please type an inventory command or question.' },
      };
    }

    const ai = this.getGeminiClient();
    const canUseCloudModel = ai && Date.now() > this.circuitBreakerUntil;

    if (canUseCloudModel) {
      try {
        const productCatalogSummary = availableProducts
          .map(p => `• ID: ${p.id || p.productId} | Name: "${p.name}" | SKU: ${p.sku} | Unit: ${p.unit} | Cost: ${p.costPrice} | Selling: ${p.sellingPrice}`)
          .join('\n');

        const systemInstruction = `
You are the WhatsApp AI Inventory Assistant for a retail & wholesale merchant.
Your sole job is to interpret the user's natural language message and call the single best function tool.

AVAILABLE APPLICATION TOOLS:
• createProduct(name, unit, costPrice, sellingPrice, minStockLevel, initialStock)
• addStock(productNameQuery, quantity, unitCost, unit)
• getStock(productNameQuery)
• recordSale(productNameQuery, quantity, unitPrice, totalAmount, customerName, unit)
• getSales(period)
• getLowStock()
• createCustomer(name, phone)
• getCustomerBalance(name)
• recordPayment(customerName, amount, paymentMethod, reference)
• askClarification(reason, questionToUser)

CRITICAL RULES:
1. You DO NOT modify the database directly. You only produce a structured tool call.
2. If ambiguous, call "askClarification".
3. Match against current products:
${productCatalogSummary}
`;

        const candidateModels = ['gemini-2.5-flash', 'gemini-flash-latest'];
        let response: any = null;

        for (const modelName of candidateModels) {
          try {
            const timeoutPromise = new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('AI assistant response timed out')), 2500)
            );

            response = await Promise.race([
              ai.models.generateContent({
                model: modelName,
                contents: trimmed,
                config: {
                  systemInstruction,
                  temperature: 0.1,
                  tools: [{ functionDeclarations: inventoryTools }],
                },
              }),
              timeoutPromise
            ]);

            if (response) break;
          } catch (modelErr: any) {
            continue;
          }
        }

        if (!response) {
          this.circuitBreakerUntil = Date.now() + 30000;
        }

        if (response) {
          const functionCalls = response.functionCalls;
          if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            const args = (call.args || {}) as any;

            switch (call.name) {
              case 'addStock':
              case 'add_stock':
                return {
                  intent: 'ADD_STOCK',
                  functionCalled: 'addStock',
                  confidence: 0.95,
                  parameters: {
                    productNameQuery: args.productNameQuery,
                    quantity: Number(args.quantity),
                    unitCost: args.unitCost !== undefined ? Number(args.unitCost) : undefined,
                    unit: args.unit,
                  },
                };

              case 'recordSale':
              case 'record_sale':
                return {
                  intent: 'RECORD_SALE',
                  functionCalled: 'recordSale',
                  confidence: 0.95,
                  parameters: {
                    productNameQuery: args.productNameQuery,
                    quantity: Number(args.quantity),
                    unitPrice: args.unitPrice !== undefined ? Number(args.unitPrice) : undefined,
                    totalAmount: args.totalAmount !== undefined ? Number(args.totalAmount) : undefined,
                    customerName: args.customerName,
                    unit: args.unit,
                  },
                };

              case 'getStock':
              case 'check_stock':
                return {
                  intent: 'QUERY_STOCK',
                  functionCalled: 'getStock',
                  confidence: 0.95,
                  parameters: {
                    productNameQuery: args.productNameQuery,
                  },
                };

              case 'getSales':
              case 'get_sales_summary':
                return {
                  intent: 'QUERY_TODAY_SALES',
                  functionCalled: 'getSales',
                  confidence: 0.95,
                  parameters: {},
                };

              case 'getLowStock':
              case 'get_low_stock':
                return {
                  intent: 'QUERY_LOW_STOCK',
                  functionCalled: 'getLowStock',
                  confidence: 0.95,
                  parameters: {},
                };

              case 'createProduct':
              case 'create_product':
                return {
                  intent: 'CREATE_PRODUCT',
                  functionCalled: 'createProduct',
                  confidence: 0.95,
                  parameters: {
                    productNameQuery: args.name,
                    unit: args.unit,
                    costPrice: Number(args.costPrice),
                    sellingPrice: Number(args.sellingPrice),
                    minStockLevel: args.minStockLevel ? Number(args.minStockLevel) : undefined,
                    quantity: args.initialStock ? Number(args.initialStock) : 0,
                  },
                };

              case 'createCustomer':
                return {
                  intent: 'CREATE_CUSTOMER',
                  functionCalled: 'createCustomer',
                  confidence: 0.95,
                  parameters: {
                    customerName: args.name,
                    customerPhone: args.phone,
                  },
                };

              case 'getCustomerBalance':
                return {
                  intent: 'QUERY_CUSTOMER_BALANCE',
                  functionCalled: 'getCustomerBalance',
                  confidence: 0.95,
                  parameters: {
                    customerName: args.name,
                  },
                };

              case 'recordPayment':
                return {
                  intent: 'RECORD_PAYMENT',
                  functionCalled: 'recordPayment',
                  confidence: 0.95,
                  parameters: {
                    customerName: args.customerName,
                    paymentAmount: Number(args.amount),
                    paymentMethod: args.paymentMethod,
                    paymentReference: args.reference,
                  },
                };

              case 'askClarification':
              case 'ask_clarification':
                return {
                  intent: 'CLARIFICATION',
                  functionCalled: 'askClarification',
                  confidence: 0.9,
                  parameters: {
                    clarificationPrompt: args.questionToUser || args.reason,
                  },
                };
            }
          }
        }
      } catch (_ignored) {
        // Fallback to local semantic intent interpreter seamlessly
      }
    }

    return this.fallbackLocalParser(trimmed, availableProducts);
  }

  private static fallbackLocalParser(
    text: string, 
    products: Product[]
  ): ParsedAssistantIntent {
    const lower = text.toLowerCase();

    // 1. Sales Summary ("What did I sell today?", "today sales", "sales today")
    if (
      lower.includes('sell today') || 
      lower.includes('sold today') || 
      lower.includes('today sales') || 
      lower.includes('sales today') ||
      lower.includes('todays sales') ||
      lower === 'sales'
    ) {
      return {
        intent: 'QUERY_TODAY_SALES',
        functionCalled: 'getSales',
        confidence: 0.95,
        parameters: {},
      };
    }

    // 2. Low stock query ("Which products are low?", "low stock", "what is running out")
    if (
      lower.includes('low') || 
      lower.includes('running out') || 
      lower.includes('out of stock') || 
      lower.includes('need to reorder')
    ) {
      return {
        intent: 'QUERY_LOW_STOCK',
        functionCalled: 'getLowStock',
        confidence: 0.95,
        parameters: {},
      };
    }

    // 3. Customer balance ("How much does Obi owe?", "customer balance Obi", "balance of Obi")
    if (lower.includes('owe') || lower.includes('balance for') || (lower.includes('balance') && lower.includes('customer'))) {
      const match = lower.match(/(?:does|for|balance of|customer balance)\s+([a-z\s]+?)(?:\s+owe|\?|$)/i);
      const name = match ? match[1].trim() : 'Customer';
      return {
        intent: 'QUERY_CUSTOMER_BALANCE',
        functionCalled: 'getCustomerBalance',
        confidence: 0.92,
        parameters: { customerName: name },
      };
    }

    // 4. Record payment ("Obi paid 10000", "Received 5000 from Obi", "Payment of 15000 from Emeka")
    if (lower.includes('paid') || lower.includes('payment of') || lower.includes('received payment')) {
      const amountMatch = lower.match(/(?:paid|payment of|received)\s+(?:₦|ngn|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i) ||
                          lower.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:from|cash|transfer)/i);
      const nameMatch = lower.match(/(?:from|by)\s+([a-z\s]+)/i) || lower.match(/^([a-z\s]+)\s+paid/i);
      
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
      const customerName = nameMatch ? nameMatch[1].trim() : 'Customer';

      if (amount > 0) {
        return {
          intent: 'RECORD_PAYMENT',
          functionCalled: 'recordPayment',
          confidence: 0.92,
          parameters: {
            customerName,
            paymentAmount: amount,
            paymentMethod: lower.includes('transfer') ? 'TRANSFER' : (lower.includes('pos') ? 'POS' : 'CASH'),
          },
        };
      }
    }

    // 5. Create customer ("Create customer Obi phone 08012345678", "New customer Emeka")
    if (lower.startsWith('create customer') || lower.startsWith('new customer') || lower.startsWith('add customer')) {
      const nameMatch = text.match(/(?:customer)[:\s]+([a-zA-Z\s]+?)(?:\s+phone|$)/i);
      const phoneMatch = text.match(/phone[:\s]+([0-9+\s-]+)/i);
      if (nameMatch) {
        return {
          intent: 'CREATE_CUSTOMER',
          functionCalled: 'createCustomer',
          confidence: 0.95,
          parameters: {
            customerName: nameMatch[1].trim(),
            customerPhone: phoneMatch ? phoneMatch[1].trim() : '',
          },
        };
      }
    }

    // 6. Stock Query ("How much Indomie do I have?", "check stock", "how many cartons left")
    const stockQueryMatch = lower.match(/(?:how much|how many|check stock|check|stock of|do i have|current stock|balance of)\s+([a-z0-9\s-]+?)(?:\s+do i have|\s+left|\s+in stock|\?|$)/i);
    if (stockQueryMatch && stockQueryMatch[1]) {
      const prodQuery = stockQueryMatch[1].trim();
      if (prodQuery && !prodQuery.includes('sell') && !prodQuery.includes('sold')) {
        return {
          intent: 'QUERY_STOCK',
          functionCalled: 'getStock',
          confidence: 0.9,
          parameters: {
            productNameQuery: prodQuery,
          },
        };
      }
    }

    if (lower.startsWith('how much ') || lower.startsWith('how many ')) {
      const remaining = lower.replace(/how (?:much|many)\s+/, '').replace(/\s+(?:do i have|left|in stock|are there)\??/g, '').trim();
      if (remaining) {
        return {
          intent: 'QUERY_STOCK',
          functionCalled: 'getStock',
          confidence: 0.88,
          parameters: { productNameQuery: remaining },
        };
      }
    }

    // 7. Record Sale ("I sold 5 cartons of Indomie for 42500", "Sold 2 bags of sugar at 84000")
    if (lower.includes('sold') || lower.startsWith('sell ') || lower.includes('recorded sale')) {
      const qtyMatch = lower.match(/(?:sold|sell|recorded sale)\s+(\d+(?:\.\d+)?)/i) || 
                       lower.match(/(\d+(?:\.\d+)?)\s*(?:cartons?|packs?|bags?|pieces?|tins?|bottles?|units?|rolls?)/i);
      const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : null;

      const forPriceMatch = lower.match(/for\s+(?:₦|ngn|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
      const atPriceMatch = lower.match(/at\s+(?:₦|ngn|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)(?:\s+each)?/i);

      let totalAmount: number | undefined;
      let unitPrice: number | undefined;

      if (forPriceMatch) {
        totalAmount = parseFloat(forPriceMatch[1].replace(/,/g, ''));
      }
      if (atPriceMatch) {
        unitPrice = parseFloat(atPriceMatch[1].replace(/,/g, ''));
      }

      let productPart = lower
        .replace(/(?:i\s+)?sold\s+/i, '')
        .replace(/^sell\s+/i, '')
        .replace(/\b\d+(?:\.\d+)?\b/g, '')
        .replace(/\b(?:cartons?|packs?|bags?|pieces?|tins?|bottles?|units?|rolls?)\b/g, '')
        .replace(/\bof\b/g, '')
        .replace(/for\s+(?:₦|ngn|\$)?\s*\d+(?:,\d+)*(?:\.\d+)?/gi, '')
        .replace(/at\s+(?:₦|ngn|\$)?\s*\d+(?:,\d+)*(?:\.\d+)?(?:\s+each)?/gi, '')
        .trim();

      const customerMatch = productPart.match(/to\s+([a-z\s]+)$/i);
      let customerName: string | undefined;
      if (customerMatch) {
        customerName = customerMatch[1].trim();
        productPart = productPart.replace(/to\s+([a-z\s]+)$/i, '').trim();
      }

      if (!quantity) {
        return {
          intent: 'CLARIFICATION',
          functionCalled: 'askClarification',
          confidence: 0.95,
          parameters: {
            clarificationPrompt: 'Please specify the quantity sold. For example: "I sold 5 cartons of Indomie for 42500".',
          },
        };
      }

      if (!productPart || productPart.length < 2) {
        return {
          intent: 'CLARIFICATION',
          functionCalled: 'askClarification',
          confidence: 0.95,
          parameters: {
            clarificationPrompt: 'Which product did you sell? Please include the product name.',
          },
        };
      }

      return {
        intent: 'RECORD_SALE',
        functionCalled: 'recordSale',
        confidence: 0.9,
        parameters: {
          productNameQuery: productPart,
          quantity,
          unitPrice,
          totalAmount,
          customerName,
        },
      };
    }

    // 8. Add Stock ("Add 50 cartons of Indomie at 7500 each")
    if (lower.startsWith('add ') || lower.startsWith('restock ') || lower.includes('received stock') || lower.includes('new stock')) {
      const qtyMatch = lower.match(/(?:add|restock|received stock|new stock)\s+(\d+(?:\.\d+)?)/i) || 
                       lower.match(/(\d+(?:\.\d+)?)\s*(?:cartons?|packs?|bags?|pieces?|tins?|bottles?|units?|rolls?)/i);
      const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : null;

      const atPriceMatch = lower.match(/(?:at|costing|@)\s+(?:₦|ngn|\$)?\s*(\d+(?:,\d+)*(?:\.\d+)?)(?:\s+each)?/i);
      const unitCost = atPriceMatch ? parseFloat(atPriceMatch[1].replace(/,/g, '')) : undefined;

      let productPart = lower
        .replace(/^(?:add|restock|received stock|new stock)\s+/i, '')
        .replace(/\b\d+(?:\.\d+)?\b/g, '')
        .replace(/\b(?:cartons?|packs?|bags?|pieces?|tins?|bottles?|units?|rolls?)\b/g, '')
        .replace(/\bof\b/g, '')
        .replace(/(?:at|costing|@)\s+(?:₦|ngn|\$)?\s*\d+(?:,\d+)*(?:\.\d+)?(?:\s+each)?/gi, '')
        .trim();

      if (!quantity) {
        return {
          intent: 'CLARIFICATION',
          functionCalled: 'askClarification',
          confidence: 0.95,
          parameters: {
            clarificationPrompt: 'Please specify the quantity to add. For example: "Add 50 cartons of Indomie at 7500 each".',
          },
        };
      }

      if (!productPart || productPart.length < 2) {
        return {
          intent: 'CLARIFICATION',
          functionCalled: 'askClarification',
          confidence: 0.95,
          parameters: {
            clarificationPrompt: 'Which product are you adding stock for? Please specify the product name.',
          },
        };
      }

      return {
        intent: 'ADD_STOCK',
        functionCalled: 'addStock',
        confidence: 0.9,
        parameters: {
          productNameQuery: productPart,
          quantity,
          unitCost,
        },
      };
    }

    // 9. Create product ("create product: Milo, unit: roll, cost: 19000, sell: 21500")
    if (lower.startsWith('create product') || lower.startsWith('new product')) {
      const nameMatch = text.match(/(?:product|new product)[:\s]+([^,]+)/i);
      const costMatch = text.match(/cost[:\s]+(?:₦|ngn|\$)?\s*(\d+(?:,\d+)*)/i);
      const sellMatch = text.match(/(?:sell|price)[:\s]+(?:₦|ngn|\$)?\s*(\d+(?:,\d+)*)/i);
      const unitMatch = text.match(/unit[:\s]+([a-z]+)/i);

      if (nameMatch && (costMatch || sellMatch)) {
        return {
          intent: 'CREATE_PRODUCT',
          functionCalled: 'createProduct',
          confidence: 0.9,
          parameters: {
            productNameQuery: nameMatch[1].trim(),
            unit: unitMatch ? unitMatch[1].trim() : 'unit',
            costPrice: costMatch ? parseFloat(costMatch[1].replace(/,/g, '')) : 0,
            sellingPrice: sellMatch ? parseFloat(sellMatch[1].replace(/,/g, '')) : 0,
          },
        };
      }
    }

    // Default clarification
    return {
      intent: 'CLARIFICATION',
      functionCalled: 'askClarification',
      confidence: 0.5,
      parameters: {
        clarificationPrompt: `I didn't quite catch that. You can tell me commands like:
• "Add 50 cartons of Indomie at 7500 each"
• "I sold 5 cartons of Indomie for 42500"
• "How much Indomie do I have?"
• "What did I sell today?"
• "Which products are low?"`,
      },
    };
  }
}
