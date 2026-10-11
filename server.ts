import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

import { WhatsAppWorkflowOrchestrator } from './server/modules/workflow.ts';
import { ProductService } from './server/modules/products/index.ts';
import { InventoryService } from './server/modules/inventory/index.ts';
import { SalesService } from './server/modules/sales/index.ts';
import { CustomerService } from './server/modules/customers/index.ts';
import { AuditService } from './server/modules/audit/index.ts';
import { AuthService } from './server/modules/auth/index.ts';
import { BusinessService } from './server/modules/businesses/index.ts';
import { db } from './server/db/storage.ts';
import { firestoreDb } from './server/db/firestoreStorage.ts';
import { 
  ConversationProcessor, 
  normalizeWebChatMessage, 
  WhatsAppProviderRegistry 
} from './whatsapp/index.ts';
import { config, validateStartupConfig } from './server/config.ts';
import { verifyMetaSignature } from './whatsapp/security/webhookSignature.ts';
import { WhatsAppLogger } from './whatsapp/logger.ts';

dotenv.config();

const PORT = 3000;
const HOST = '0.0.0.0';

async function startServer() {
  // Validate startup environment variables
  validateStartupConfig();

  const app = express();

  // Capture raw request body for HMAC cryptographic webhook verification
  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }));

  // Security Middleware: Authoritative multi-tenant business context
  // Requirement 10: "Never trust businessId supplied by the client. Determine the user's business from the authenticated user."
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      try {
        const userContext = await AuthService.resolveUserFromRequest(req.headers);
        (req as any).user = userContext;
        (req as any).businessId = userContext.businessId;
      } catch (e) {
        const demo = AuthService.getDefaultDemoUser();
        (req as any).user = demo;
        (req as any).businessId = demo.businessId;
      }
    }
    next();
  });

  // --- API Routes ---

  // Health check: reports application readiness and dependency readiness without leaking secrets
  app.get('/api/health', (req, res) => {
    try {
      const isDbConnected = Boolean(firestoreDb);
      const isGeminiConfigured = Boolean(config.geminiApiKey);
      const isMetaWebhookConfigured = Boolean(config.metaAppSecret && config.whatsappVerifyToken);
      const isWhatsAppConfigured = Boolean(config.whatsappAccessToken && config.whatsappPhoneNumberId);

      const status = isDbConnected 
        ? (isGeminiConfigured ? 'healthy' : 'degraded')
        : 'unhealthy';

      res.status(status === 'unhealthy' ? 503 : 200).json({
        status,
        timestamp: new Date().toISOString(),
        readiness: {
          app: 'ready',
          database: {
            provider: 'firestore',
            status: isDbConnected ? 'connected' : 'disconnected',
          },
          ai: {
            provider: 'gemini',
            status: isGeminiConfigured ? 'ready' : 'fallback_heuristic',
          },
          whatsapp: {
            webhookSignatureVerification: isMetaWebhookConfigured ? 'enforced' : 'unconfigured_rejects_in_prod',
            cloudApi: isWhatsAppConfigured ? 'configured' : 'stub_mode',
            wabaConfigured: Boolean(config.whatsappBusinessAccountId),
            phoneIdConfigured: Boolean(config.whatsappPhoneNumberId),
          },
        },
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check probe failed',
      });
    }
  });

  // Current authenticated user & business info
  app.get('/api/auth/me', async (req, res) => {
    try {
      const user = (req as any).user || AuthService.getDefaultDemoUser();
      const business = await BusinessService.getBusiness(user.businessId);
      res.json({ user, business });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Register user profile & business upon Firebase Auth Sign Up
  app.post('/api/auth/register-profile', async (req, res) => {
    try {
      const { userId, email, name, businessId, businessName } = req.body;
      const now = new Date().toISOString();
      const finalBizId = businessId || `biz_${userId.slice(0, 10)}`;

      await firestoreDb.createBusiness({
        businessId: finalBizId,
        id: finalBizId,
        name: businessName || `${name}'s Provisions`,
        businessType: 'Retail & Wholesale Provisions',
        currency: 'NGN',
        currencySymbol: '₦',
        country: 'Nigeria',
        ownerId: userId,
        ownerName: name,
        createdAt: now,
        updatedAt: now,
      });

      await firestoreDb.createUser({
        userId,
        businessId: finalBizId,
        email: email || 'user@business.ng',
        name: name || 'Merchant',
        role: 'OWNER',
        createdAt: now,
        updatedAt: now,
      });

      // Migrate demo catalog into persistent Firestore for the user
      await firestoreDb.seedDemoCatalog(finalBizId);

      res.json({ success: true, businessId: finalBizId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Main Web Chat incoming message handler (normalized message interface)
  app.post('/api/chat/message', async (req, res) => {
    try {
      const { message } = req.body;
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message text is required.' });
        return;
      }

      // Pass web chat through normalized message interface and conversation processor
      const normalized = normalizeWebChatMessage({
        text: message,
        businessId,
        senderName: actor,
        senderId: (req as any).user?.uid || 'web_user',
      });

      const response = await ConversationProcessor.process(normalized);
      res.json({
        success: response.success,
        dashboardRefreshRequired: response.dashboardRefreshRequired,
        message: {
          id: `asst_${response.messageId}`,
          sender: 'assistant',
          text: response.text,
          timestamp: new Date().toISOString(),
          status: 'read',
          structuredData: response.data,
        },
      });
    } catch (err: any) {
      console.warn('Notice in chat message endpoint:', err.message || err);
      res.status(200).json({
        success: false,
        dashboardRefreshRequired: false,
        message: {
          id: `err_${Date.now()}`,
          sender: 'assistant',
          text: `⚠️ *Notice:* Could not process message. ${err.message || 'Please try again.'}`,
          timestamp: new Date().toISOString(),
          status: 'read',
        },
      });
    }
  });

  // --- WhatsApp Cloud API Webhook Integration ---

  // Meta Webhook Verification (hub.challenge)
  app.get('/api/whatsapp/webhook', (req, res) => {
    try {
      const provider = WhatsAppProviderRegistry.getProvider('whatsapp_meta');
      const verification = provider.verifyWebhook(
        req.query,
        config.whatsappVerifyToken
      );

      if (verification.isValid && verification.challenge) {
        res.status(200).send(verification.challenge);
      } else {
        res.status(403).send('Verification failed');
      }
    } catch (err: any) {
      res.status(500).send('Webhook verification error');
    }
  });

  // Meta Webhook Ingestion with Cryptographic HMAC-SHA256 Verification
  app.post('/api/whatsapp/webhook', async (req, res) => {
    try {
      const signatureHeader = req.headers['x-hub-signature-256'];
      const rawBody = (req as any).rawBody;

      // Cryptographic verification using META_APP_SECRET
      const verification = verifyMetaSignature(rawBody, signatureHeader);
      if (!verification.isValid) {
        WhatsAppLogger.log({
          event: 'webhook_rejected',
          reason: verification.reason,
          statusCode: verification.statusCode,
        });
        res.status(verification.statusCode).json({ error: verification.reason });
        return;
      }

      const provider = WhatsAppProviderRegistry.getProvider('whatsapp_meta');
      const fallbackBusinessId = (req.query.businessId as string) || (req as any).businessId || 'biz_bello_01';
      const incomingMessages = await provider.receiveMessage(req.body, fallbackBusinessId);

      if (!incomingMessages || incomingMessages.length === 0) {
        res.status(200).json({ status: 'ok', processed: 0 });
        return;
      }

      const results = [];
      for (const msg of incomingMessages) {
        const result = await ConversationProcessor.process(msg);
        results.push(result);
      }

      res.status(200).json({
        status: 'ok',
        processed: results.length,
        results,
      });
    } catch (err: any) {
      console.warn('Error in WhatsApp webhook endpoint:', err.message || err);
      res.status(500).json({ error: err.message });
    }
  });

  // Simulate WhatsApp message endpoint for interactive UI / testing
  app.post('/api/whatsapp/simulate', async (req, res) => {
    try {
      const { message, senderId, senderPhone, businessId, messageId } = req.body;
      const targetBizId = businessId || (req as any).businessId || 'biz_bello_01';
      const provider = WhatsAppProviderRegistry.getProvider('mock_whatsapp');

      const incoming = await provider.receiveMessage({
        messageId,
        senderId: senderId || '2348012345678',
        senderPhone: senderPhone || '2348012345678',
        businessId: targetBizId,
        text: message,
        messageType: 'TEXT',
      }, targetBizId);

      if (!incoming || incoming.length === 0) {
        res.status(400).json({ error: 'Failed to normalize message' });
        return;
      }

      const result = await ConversationProcessor.process(incoming[0]);
      res.json({
        result,
        lastSentMessage: (provider as any).getLastSentMessage?.(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Dashboard metrics
  app.get('/api/dashboard', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const business = await BusinessService.getBusiness(businessId);
      const inventorySummary = await InventoryService.getInventorySummary(businessId);
      const todaySales = await SalesService.getTodaySales(businessId);
      const recentTransactions = await InventoryService.getTransactions(businessId, 10);
      const recentSales = await SalesService.getSalesHistory(businessId, 10);

      res.json({
        totalProducts: inventorySummary.totalProducts,
        currentInventoryValue: inventorySummary.totalInventoryValue,
        todaySalesRevenue: todaySales.totalRevenue,
        todaySalesCount: todaySales.totalCount,
        lowStockCount: inventorySummary.lowStockCount,
        lowStockProducts: inventorySummary.lowStockProducts,
        recentTransactions,
        recentSales,
        currencySymbol: business.currencySymbol || '₦',
        currency: business.currency || 'NGN',
        businessName: business.name,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Products CRUD
  app.get('/api/products', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const products = await ProductService.listProducts(businessId);
      res.json({ products });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/products', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const { name, sku, unit, costPrice, sellingPrice, minStockLevel, initialStock } = req.body;

      const product = await ProductService.createProduct(businessId, actor, {
        name,
        sku,
        unit,
        costPrice: Number(costPrice),
        sellingPrice: Number(sellingPrice),
        minStockLevel: minStockLevel !== undefined ? Number(minStockLevel) : undefined,
        initialStock: initialStock !== undefined ? Number(initialStock) : 0,
      });

      res.status(201).json({ product });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/products/:id', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const productId = req.params.id;
      const { name, costPrice, sellingPrice, unit, minStockLevel, active } = req.body;

      const product = await ProductService.updateProduct(businessId, actor, productId, {
        name,
        costPrice: costPrice !== undefined ? Number(costPrice) : undefined,
        sellingPrice: sellingPrice !== undefined ? Number(sellingPrice) : undefined,
        unit,
        minStockLevel: minStockLevel !== undefined ? Number(minStockLevel) : undefined,
        active,
      });

      res.json({ product });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Direct Stock In endpoint
  app.post('/api/inventory/stock-in', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const { productId, quantity, unitCost, notes } = req.body;

      const result = await InventoryService.addStock(businessId, actor, {
        productId,
        quantity: Number(quantity),
        unitCost: unitCost !== undefined ? Number(unitCost) : undefined,
        notes,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Manual Stock Adjustment endpoint (e.g. damages, audit counts)
  app.post('/api/inventory/adjust', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const { productId, adjustment, reason, notes } = req.body;

      const result = await InventoryService.adjustStock(businessId, actor, {
        productId,
        adjustment: Number(adjustment),
        reason,
        notes,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Inventory Reconciliation & Ledger Audit endpoint
  app.get('/api/inventory/reconcile', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const productId = req.query.productId as string | undefined;
      const reconciliation = await InventoryService.reconcileInventory(businessId, productId);
      res.json(reconciliation);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Full Inventory Report endpoint
  app.get('/api/inventory/report', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const report = await InventoryService.getInventoryReport(businessId);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Transactions Log
  app.get('/api/inventory/transactions', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const transactions = await InventoryService.getTransactions(businessId, limit);
      res.json({ transactions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sales History & Recording
  app.get('/api/sales', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const sales = await SalesService.getSalesHistory(businessId, limit);
      res.json({ sales });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sales', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const { items, customerName, customerPhone, notes, totalAmountOverride, amountPaid, paymentMethod } = req.body;

      const result = await SalesService.recordSale(businessId, actor, {
        items,
        customerName,
        customerPhone,
        notes,
        totalAmountOverride,
        amountPaid: amountPaid !== undefined ? Number(amountPaid) : undefined,
        paymentMethod,
      });

      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/sales/:id/cancel', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const saleId = req.params.id;
      const { reason } = req.body;

      const result = await SalesService.cancelSale(businessId, actor, saleId, reason);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/sales/report', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const report = await SalesService.getSalesReport(businessId, limit);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Debtors list
  app.get('/api/customers/debtors', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const debtorsReport = await CustomerService.getDebtors(businessId);
      res.json(debtorsReport);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Customer balance
  app.get('/api/customers/:id/balance', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const customerId = req.params.id;
      const balanceInfo = await CustomerService.getCustomerBalance(businessId, customerId);
      res.json(balanceInfo);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Customer debt payment
  app.post('/api/customers/payments', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const { customerNameOrId, amount, method, reference, notes } = req.body;

      const result = await CustomerService.recordCustomerPayment(businessId, actor, {
        customerNameOrId,
        amount: Number(amount),
        method,
        reference,
        notes,
      });

      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Customers
  app.get('/api/customers', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const customers = (db as any).getCustomers ? await (db as any).getCustomers(businessId) : [];
      res.json({ customers });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/customers', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const { name, phone } = req.body;
      const customer = await db.findOrCreateCustomer(businessId, name, phone);
      res.status(201).json({ customer });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Payments
  app.get('/api/payments', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const payments = (db as any).getPayments ? await (db as any).getPayments(businessId) : [];
      res.json({ payments });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/payments', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const actor = (req as any).user?.name || 'Store Owner';
      const { customerId, amount, method, reference } = req.body;
      const payment = await db.recordPayment({
        businessId,
        customerId,
        amount: Number(amount),
        method: method || 'CASH',
        reference,
        recordedBy: actor,
      });
      res.status(201).json({ payment });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Audit Logs
  app.get('/api/audit-logs', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const auditLogs = await AuditService.getAuditTrail(businessId, limit);
      res.json({ auditLogs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reset demo
  app.post('/api/demo/reset', async (req, res) => {
    try {
      const businessId = (req as any).businessId || 'biz_bello_01';
      await firestoreDb.seedDemoCatalog(businessId);
      res.json({ success: true, message: 'Database reset to default seed data.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Vite & Static Asset Handling ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`WhatsApp SME Inventory Server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
