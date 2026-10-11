import { Transaction as FsTransaction } from 'firebase-admin/firestore';
import { serverDb } from '../firebase.ts';
import { 
  Business, 
  UserProfile,
  Product, 
  InventoryTransaction, 
  Sale, 
  SaleItem,
  Customer, 
  Payment,
  AuditLog 
} from '../types.ts';
import { IDatabaseStorage, InMemoryDatabase } from './inMemoryStorage.ts';

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
 * Firebase Admin SDK-backed Multi-Tenant Database Storage.
 * 
 * Interacts directly with Cloud Firestore using the official Firebase Admin SDK.
 * Bypasses Firestore Security Rules while strictly enforcing multi-tenant isolation
 * via businessId at the application and storage layers.
 * 
 * Provides automated in-memory failover if the runtime environment lacks service
 * account credentials for the Firestore project.
 */
export class FirestoreDatabaseStorage implements IDatabaseStorage {
  private idempotencyStore = new Map<string, { result: any; expiresAt: number }>();
  private fallbackDb: InMemoryDatabase = new InMemoryDatabase();
  private isFallbackMode = false;
  private hasLoggedFallbackWarning = false;

  private handlePermissionError(err: any): boolean {
    if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED') || err?.message?.includes('Missing or insufficient permissions')) {
      this.isFallbackMode = true;
      if (!this.hasLoggedFallbackWarning) {
        console.warn('[FIREBASE_ADMIN] Firestore permission denied on project gen-lang-client-0706056165.');
        console.warn('[FIREBASE_ADMIN] Operating in persistent in-memory mode until FIREBASE_SERVICE_ACCOUNT_KEY is configured.');
        this.hasLoggedFallbackWarning = true;
      }
      return true;
    }
    return false;
  }

  // Helper to normalize product properties
  private formatProduct(data: any): Product {
    const id = data.productId || data.id;
    const minStockLevel = data.reorderLevel !== undefined ? data.reorderLevel : (data.minStockLevel || 5);
    return {
      productId: id,
      id: id,
      businessId: data.businessId,
      name: data.name,
      sku: data.sku || 'SKU-GEN',
      unit: data.unit || 'piece',
      currentStock: Number(data.currentStock || 0),
      costPrice: Number(data.costPrice || 0),
      sellingPrice: Number(data.sellingPrice || 0),
      reorderLevel: minStockLevel,
      minStockLevel: minStockLevel,
      active: data.active !== false,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  }

  // Helper to normalize transaction properties
  private formatTransaction(data: any): InventoryTransaction {
    const id = data.transactionId || data.id;
    return {
      transactionId: id,
      id: id,
      businessId: data.businessId,
      productId: data.productId,
      productName: data.productName || 'Product',
      type: data.type || 'STOCK_IN',
      quantity: Number(data.quantity || Math.abs(data.quantityChange || 0)),
      quantityChange: data.quantityChange !== undefined 
        ? Number(data.quantityChange) 
        : (data.type === 'SALE' || data.type === 'STOCK_OUT_SALE' ? -Number(data.quantity || 0) : Number(data.quantity || 0)),
      previousStock: Number(data.previousStock || 0),
      newStock: Number(data.newStock !== undefined ? data.newStock : data.resultingStock || 0),
      resultingStock: Number(data.resultingStock !== undefined ? data.resultingStock : data.newStock || 0),
      unitCost: data.unitCost !== undefined ? Number(data.unitCost) : undefined,
      referenceId: data.referenceId || `REF-${Date.now()}`,
      createdBy: data.createdBy || 'SYSTEM',
      notes: data.notes || '',
      createdAt: data.createdAt || new Date().toISOString(),
    };
  }

  // Helper to normalize sale properties
  private formatSale(data: any, items: SaleItem[] = []): Sale {
    const id = data.saleId || data.id;
    const total = Number(data.total !== undefined ? data.total : data.totalAmount || 0);
    return {
      saleId: id,
      id: id,
      businessId: data.businessId,
      invoiceNumber: data.invoiceNumber || `INV-${id}`,
      customerId: data.customerId,
      customerName: data.customerName,
      subtotal: Number(data.subtotal || total),
      discount: Number(data.discount || 0),
      total: total,
      totalAmount: total,
      amountPaid: Number(data.amountPaid !== undefined ? data.amountPaid : total),
      balanceDue: Number(data.balanceDue || 0),
      paymentStatus: data.paymentStatus || 'PAID',
      paymentMethod: data.paymentMethod || 'CASH',
      createdBy: data.createdBy || 'SYSTEM',
      items: items.length > 0 ? items : (data.items || []),
      notes: data.notes || '',
      createdAt: data.createdAt || new Date().toISOString(),
    };
  }

  // Business operations
  public async getBusiness(id: string): Promise<Business | null> {
    if (this.isFallbackMode) return this.fallbackDb.getBusiness(id);
    try {
      const snap = await serverDb.collection('businesses').doc(id).get();
      if (!snap.exists) {
        return null;
      }
      const data = snap.data() || {};
      return {
        businessId: snap.id,
        id: snap.id,
        name: data.name,
        businessType: data.businessType || 'Retail',
        currency: data.currency || 'NGN',
        currencySymbol: data.currencySymbol || (data.currency === 'NGN' ? '₦' : '$'),
        country: data.country || 'Nigeria',
        ownerId: data.ownerId || '',
        ownerName: data.ownerName || 'Merchant',
        phone: data.phone || '',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getBusiness(id);
      console.warn(`Could not get business ${id}:`, err.message);
      return null;
    }
  }

  public async createBusiness(business: Business): Promise<Business> {
    const bizId = business.businessId || business.id || `biz_${Date.now()}`;
    const now = new Date().toISOString();
    const data = {
      businessId: bizId,
      name: business.name,
      businessType: business.businessType || 'Retail & Wholesale Provisions',
      currency: business.currency || 'NGN',
      country: business.country || 'Nigeria',
      ownerId: business.ownerId || '',
      createdAt: business.createdAt || now,
      updatedAt: now,
    };
    await this.fallbackDb.createBusiness(business);
    if (this.isFallbackMode) return { ...business, businessId: bizId, id: bizId };
    try {
      await serverDb.collection('businesses').doc(bizId).set(data);
      return { ...business, businessId: bizId, id: bizId };
    } catch (err: any) {
      this.handlePermissionError(err);
      return { ...business, businessId: bizId, id: bizId };
    }
  }

  // User operations
  public async getUser(userId: string): Promise<UserProfile | null> {
    try {
      const snap = await serverDb.collection('users').doc(userId).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      return {
        userId: snap.id,
        email: data.email,
        name: data.name,
        businessId: data.businessId,
        role: data.role || 'OWNER',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    } catch (err: any) {
      return null;
    }
  }

  public async createUser(user: UserProfile): Promise<UserProfile> {
    const now = new Date().toISOString();
    const data = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      businessId: user.businessId,
      role: user.role || 'OWNER',
      createdAt: user.createdAt || now,
      updatedAt: now,
    };
    try {
      await serverDb.collection('users').doc(user.userId).set(data);
      return user;
    } catch (err: any) {
      this.handlePermissionError(err);
      return user;
    }
  }

  // Products
  public async getProduct(id: string): Promise<Product | null> {
    if (this.isFallbackMode) return this.fallbackDb.getProduct(id);
    try {
      const snap = await serverDb.collection('products').doc(id).get();
      if (!snap.exists) return null;
      return this.formatProduct({ ...snap.data(), productId: snap.id });
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getProduct(id);
      console.warn(`Failed to get product ${id}:`, err.message);
      return null;
    }
  }

  public async getAllProducts(businessId: string): Promise<Product[]> {
    if (this.isFallbackMode) return this.fallbackDb.getAllProducts(businessId);
    try {
      const snap = await serverDb.collection('products').where('businessId', '==', businessId).get();
      const list: Product[] = [];
      snap.forEach(d => {
        list.push(this.formatProduct({ ...d.data(), productId: d.id }));
      });
      return list.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getAllProducts(businessId);
      console.warn('Failed to query products from Firestore:', err.message);
      return [];
    }
  }

  public async createProduct(product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
    const productId = product.productId || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const reorderLevel = product.reorderLevel !== undefined ? product.reorderLevel : (product.minStockLevel || 5);
    const data = {
      productId,
      businessId: product.businessId,
      name: product.name,
      sku: product.sku || `SKU-${Date.now().toString().slice(-4)}`,
      unit: product.unit || 'piece',
      costPrice: Number(product.costPrice || 0),
      sellingPrice: Number(product.sellingPrice || 0),
      currentStock: Number(product.currentStock || 0),
      reorderLevel,
      active: product.active !== false,
      createdAt: now,
      updatedAt: now,
    };

    await this.fallbackDb.createProduct({ ...data, id: productId } as any);
    if (this.isFallbackMode) return this.formatProduct(data);

    try {
      await serverDb.collection('products').doc(productId).set(data);
      return this.formatProduct(data);
    } catch (err: any) {
      this.handlePermissionError(err);
      return this.formatProduct(data);
    }
  }

  public async updateProductStock(productId: string, newStock: number): Promise<Product> {
    const now = new Date().toISOString();
    await this.fallbackDb.updateProductStock(productId, newStock);
    if (this.isFallbackMode) {
      const p = await this.fallbackDb.getProduct(productId);
      return p!;
    }
    try {
      const productRef = serverDb.collection('products').doc(productId);
      await productRef.update({
        currentStock: newStock,
        updatedAt: now,
      });
      const updated = await this.getProduct(productId);
      return updated!;
    } catch (err: any) {
      if (this.handlePermissionError(err)) {
        const p = await this.fallbackDb.getProduct(productId);
        return p!;
      }
      throw err;
    }
  }

  public async updateProduct(productId: string, updates: Partial<Product>): Promise<Product> {
    const now = new Date().toISOString();
    const cleanUpdates = sanitizeForFirestore({ ...updates, updatedAt: now });
    await this.fallbackDb.updateProduct(productId, updates);
    if (this.isFallbackMode) {
      const p = await this.fallbackDb.getProduct(productId);
      return p!;
    }
    try {
      const productRef = serverDb.collection('products').doc(productId);
      await productRef.update(cleanUpdates);
      const updated = await this.getProduct(productId);
      return updated!;
    } catch (err: any) {
      if (this.handlePermissionError(err)) {
        const p = await this.fallbackDb.getProduct(productId);
        return p!;
      }
      throw err;
    }
  }

  // Inventory Transactions
  public async createInventoryTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<InventoryTransaction> {
    const txId = tx.transactionId || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const quantity = tx.quantity !== undefined ? tx.quantity : Math.abs(tx.quantityChange || 0);
    const newStock = tx.newStock !== undefined ? tx.newStock : (tx.resultingStock || 0);
    const previousStock = tx.previousStock !== undefined ? tx.previousStock : (newStock - (tx.quantityChange || quantity));

    const quantityChange = tx.quantityChange !== undefined ? tx.quantityChange : (tx.type === 'SALE' ? -quantity : quantity);

    const data = {
      transactionId: txId,
      businessId: tx.businessId,
      productId: tx.productId,
      type: tx.type,
      quantity,
      quantityChange,
      previousStock,
      newStock,
      unitCost: tx.unitCost !== undefined ? tx.unitCost : null,
      unitPrice: (tx as any).unitPrice !== undefined ? (tx as any).unitPrice : null,
      referenceId: tx.referenceId || `REF-${Date.now()}`,
      createdBy: tx.createdBy || 'SYSTEM',
      createdAt: now,
    };

    await this.fallbackDb.createInventoryTransaction({ ...data, productName: tx.productName, notes: tx.notes } as any);
    if (this.isFallbackMode) return this.formatTransaction({ ...data, productName: tx.productName, notes: tx.notes });

    try {
      await serverDb.collection('inventoryTransactions').doc(txId).set(data);
      return this.formatTransaction({ ...data, productName: tx.productName, notes: tx.notes });
    } catch (err: any) {
      this.handlePermissionError(err);
      return this.formatTransaction({ ...data, productName: tx.productName, notes: tx.notes });
    }
  }

  public async getInventoryTransactions(businessId: string, limitCount?: number | string): Promise<InventoryTransaction[]> {
    const count = limitCount !== undefined ? Number(limitCount) : undefined;
    if (this.isFallbackMode) return this.fallbackDb.getInventoryTransactions(businessId, count);
    try {
      const snap = await serverDb.collection('inventoryTransactions').where('businessId', '==', businessId).get();
      const list: InventoryTransaction[] = [];
      snap.forEach(d => {
        list.push(this.formatTransaction({ ...d.data(), transactionId: d.id }));
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const max = limitCount !== undefined ? Number(limitCount) : 50;
      return list.slice(0, max);
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getInventoryTransactions(businessId, count);
      console.warn('Failed to query inventoryTransactions:', err.message);
      return [];
    }
  }

  public async getInventoryTransactionsByProduct(businessId: string, productId: string): Promise<InventoryTransaction[]> {
    if (this.isFallbackMode && this.fallbackDb.getInventoryTransactionsByProduct) {
      return this.fallbackDb.getInventoryTransactionsByProduct(businessId, productId);
    }
    try {
      const snap = await serverDb.collection('inventoryTransactions')
        .where('businessId', '==', businessId)
        .where('productId', '==', productId)
        .get();
      const list: InventoryTransaction[] = [];
      snap.forEach(d => {
        list.push(this.formatTransaction({ ...d.data(), transactionId: d.id }));
      });
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (err: any) {
      if (this.handlePermissionError(err) && this.fallbackDb.getInventoryTransactionsByProduct) {
        return this.fallbackDb.getInventoryTransactionsByProduct(businessId, productId);
      }
      return [];
    }
  }

  // Sales
  public async createSale(sale: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'>): Promise<Sale> {
    const saleId = sale.saleId || `sale_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    const total = Number(sale.total !== undefined ? sale.total : (sale.totalAmount || 0));

    const saleData = {
      saleId,
      businessId: sale.businessId,
      invoiceNumber,
      customerId: sale.customerId || null,
      customerName: sale.customerName || null,
      subtotal: Number(sale.subtotal || total),
      discount: Number(sale.discount || 0),
      total,
      amountPaid: Number(sale.amountPaid !== undefined ? sale.amountPaid : total),
      balanceDue: Number(sale.balanceDue || 0),
      paymentStatus: sale.paymentStatus || 'PAID',
      paymentMethod: sale.paymentMethod || 'CASH',
      createdBy: sale.createdBy || 'SYSTEM',
      notes: sale.notes || '',
      createdAt: now,
    };

    const savedItems: SaleItem[] = [];
    if (sale.items && sale.items.length > 0) {
      for (const item of sale.items) {
        const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        savedItems.push({
          itemId,
          saleId,
          businessId: sale.businessId,
          productId: item.productId,
          productNameSnapshot: item.productNameSnapshot || item.productName || 'Product',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice || 0,
          total: item.total !== undefined ? item.total : (item.subtotal || item.quantity * item.unitPrice),
        });
      }
    }

    await this.fallbackDb.createSale({ ...saleData, items: savedItems } as any);
    if (this.isFallbackMode) return this.formatSale(saleData, savedItems);

    try {
      await serverDb.collection('sales').doc(saleId).set(saleData);
      for (const it of savedItems) {
        await serverDb.collection('saleItems').doc(it.itemId!).set(it);
      }
      return this.formatSale(saleData, savedItems);
    } catch (err: any) {
      this.handlePermissionError(err);
      return this.formatSale(saleData, savedItems);
    }
  }

  public async getSales(businessId: string, limitCount: number = 50): Promise<Sale[]> {
    if (this.isFallbackMode) return this.fallbackDb.getSales(businessId, limitCount);
    try {
      const snap = await serverDb.collection('sales').where('businessId', '==', businessId).get();
      const list: Sale[] = [];
      for (const d of snap.docs) {
        const sData = d.data();
        let items: SaleItem[] = [];
        try {
          const itemsSnap = await serverDb.collection('saleItems').where('saleId', '==', d.id).get();
          items = itemsSnap.docs.map(idoc => idoc.data() as SaleItem);
        } catch {}
        list.push(this.formatSale({ ...sData, saleId: d.id }, items));
      }
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return list.slice(0, limitCount);
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getSales(businessId, limitCount);
      console.warn('Failed to query sales:', err.message);
      return [];
    }
  }

  public async getTodaySales(businessId: string): Promise<Sale[]> {
    if (this.isFallbackMode) return this.fallbackDb.getTodaySales(businessId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startIso = startOfDay.toISOString();

    try {
      const snap = await serverDb.collection('sales')
        .where('businessId', '==', businessId)
        .where('createdAt', '>=', startIso)
        .get();
      const list: Sale[] = [];
      for (const d of snap.docs) {
        list.push(this.formatSale({ ...d.data(), saleId: d.id }, []));
      }
      return list;
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getTodaySales(businessId);
      console.warn('Failed to query today sales:', err.message);
      return [];
    }
  }

  public async getSale(saleIdOrInvoice: string): Promise<Sale | null> {
    if (this.isFallbackMode && this.fallbackDb.getSale) return this.fallbackDb.getSale(saleIdOrInvoice);
    try {
      const snap = await serverDb.collection('sales').doc(saleIdOrInvoice).get();
      let saleData: any = null;
      let saleId = saleIdOrInvoice;

      if (snap.exists) {
        saleData = snap.data();
      } else {
        const qSnap = await serverDb.collection('sales').where('invoiceNumber', '==', saleIdOrInvoice).limit(1).get();
        if (!qSnap.empty) {
          saleData = qSnap.docs[0].data();
          saleId = qSnap.docs[0].id;
        }
      }

      if (!saleData) return null;

      let items: SaleItem[] = [];
      try {
        const itemsSnap = await serverDb.collection('saleItems').where('saleId', '==', saleId).get();
        items = itemsSnap.docs.map(d => d.data() as SaleItem);
      } catch {}

      return this.formatSale({ ...saleData, saleId }, items);
    } catch (err: any) {
      if (this.handlePermissionError(err) && this.fallbackDb.getSale) return this.fallbackDb.getSale(saleIdOrInvoice);
      return null;
    }
  }

  public async updateSale(saleId: string, updates: Partial<Sale>): Promise<Sale> {
    if (this.fallbackDb.updateSale) await this.fallbackDb.updateSale(saleId, updates);
    if (this.isFallbackMode) {
      const s = await this.getSale(saleId);
      return s!;
    }
    try {
      const saleRef = serverDb.collection('sales').doc(saleId);
      await saleRef.update(sanitizeForFirestore(updates));
      const s = await this.getSale(saleId);
      return s!;
    } catch (err: any) {
      if (this.handlePermissionError(err)) {
        const s = await this.fallbackDb.getSale(saleId);
        return s!;
      }
      throw err;
    }
  }

  // Customers
  public async getCustomer(id: string): Promise<Customer | null> {
    if (this.isFallbackMode) return this.fallbackDb.getCustomer(id);
    try {
      const snap = await serverDb.collection('customers').doc(id).get();
      if (!snap.exists) return null;
      const data = snap.data() || {};
      return {
        customerId: snap.id,
        id: snap.id,
        businessId: data.businessId,
        name: data.name,
        phone: data.phone,
        balance: Number(data.balance || 0),
        totalPurchases: Number(data.totalPurchases || 0),
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getCustomer(id);
      return null;
    }
  }

  public async getCustomers(businessId: string): Promise<Customer[]> {
    if (this.isFallbackMode && this.fallbackDb.getCustomers) return this.fallbackDb.getCustomers(businessId);
    try {
      const snap = await serverDb.collection('customers').where('businessId', '==', businessId).get();
      return snap.docs.map(d => {
        const data = d.data();
        return {
          customerId: d.id,
          id: d.id,
          businessId: data.businessId,
          name: data.name,
          phone: data.phone,
          balance: Number(data.balance || 0),
          totalPurchases: Number(data.totalPurchases || 0),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
    } catch (err: any) {
      if (this.handlePermissionError(err) && this.fallbackDb.getCustomers) return this.fallbackDb.getCustomers(businessId);
      return [];
    }
  }

  public async findOrCreateCustomer(businessId: string, name: string, phone?: string): Promise<Customer> {
    const existing = await this.fallbackDb.findOrCreateCustomer(businessId, name, phone);
    if (this.isFallbackMode) return existing;

    try {
      const snap = await serverDb.collection('customers').where('businessId', '==', businessId).get();
      const match = snap.docs.find(d => {
        const c = d.data();
        if (phone && c.phone && c.phone === phone) return true;
        return c.name.trim().toLowerCase() === name.trim().toLowerCase();
      });

      if (match) {
        const data = match.data();
        return {
          customerId: match.id,
          id: match.id,
          businessId: data.businessId,
          name: data.name,
          phone: data.phone,
          balance: Number(data.balance || 0),
          totalPurchases: Number(data.totalPurchases || 0),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      }

      const customerId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const now = new Date().toISOString();
      const newCustomer = {
        customerId,
        id: customerId,
        businessId,
        name: name.trim(),
        phone: phone || '',
        balance: 0,
        totalPurchases: 0,
        createdAt: now,
        updatedAt: now,
      };

      await serverDb.collection('customers').doc(customerId).set(newCustomer);
      return newCustomer;
    } catch (err: any) {
      this.handlePermissionError(err);
      return existing;
    }
  }

  public async updateCustomerBalance(customerId: string, balanceDelta: number, totalPurchasesDelta: number = 0, preloadedCustomer?: any): Promise<Customer> {
    await this.fallbackDb.updateCustomerBalance(customerId, balanceDelta, totalPurchasesDelta, preloadedCustomer);
    if (this.isFallbackMode) {
      const c = await this.fallbackDb.getCustomer(customerId);
      return c!;
    }

    try {
      const custRef = serverDb.collection('customers').doc(customerId);
      let current = preloadedCustomer;
      if (!current) {
        const snap = await custRef.get();
        if (!snap.exists) {
          throw new Error(`Customer "${customerId}" not found.`);
        }
        current = snap.data();
      }

      const newBalance = Math.max(0, Number(current.balance || 0) + balanceDelta);
      const newTotalPurchases = (Number(current.totalPurchases) || 0) + totalPurchasesDelta;
      const now = new Date().toISOString();

      await custRef.update({
        balance: newBalance,
        totalPurchases: newTotalPurchases,
        updatedAt: now,
      });

      return {
        customerId,
        id: customerId,
        businessId: current.businessId,
        name: current.name,
        phone: current.phone,
        balance: newBalance,
        totalPurchases: newTotalPurchases,
        createdAt: current.createdAt,
        updatedAt: now,
      };
    } catch (err: any) {
      if (this.handlePermissionError(err)) {
        const c = await this.fallbackDb.getCustomer(customerId);
        return c!;
      }
      throw err;
    }
  }

  public async getCustomerBalance(businessId: string, nameOrId: string): Promise<{ customer: Customer | null; balance: number }> {
    return this.fallbackDb.getCustomerBalance(businessId, nameOrId);
  }

  // Payments
  public async recordPayment(payment: any): Promise<Payment> {
    const paymentId = payment.paymentId || `pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const data: Payment = sanitizeForFirestore({
      paymentId,
      id: paymentId,
      businessId: payment.businessId,
      customerId: payment.customerId || null,
      saleId: payment.saleId || null,
      amount: payment.amount,
      method: payment.method || 'CASH',
      reference: payment.reference || `PAY-${Date.now()}`,
      recordedBy: payment.recordedBy || 'SYSTEM',
      createdAt: now,
    });

    await this.fallbackDb.recordPayment(data);
    if (this.isFallbackMode) return data;

    try {
      await serverDb.collection('payments').doc(paymentId).set(data);
      if (payment.customerId && payment.amount > 0) {
        await this.updateCustomerBalance(payment.customerId, -payment.amount);
      }
      return data;
    } catch (err: any) {
      this.handlePermissionError(err);
      return data;
    }
  }

  public async getPayments(businessId: string, limitCount: number = 50): Promise<Payment[]> {
    if (this.isFallbackMode) return this.fallbackDb.getPayments(businessId, limitCount);
    try {
      const snap = await serverDb.collection('payments').where('businessId', '==', businessId).get();
      const list = snap.docs.map(d => d.data() as Payment);
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return list.slice(0, limitCount);
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getPayments(businessId, limitCount);
      return [];
    }
  }

  // Audit Logs
  public async createAuditLog(log: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog> {
    const logId = log.logId || `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = log.timestamp || new Date().toISOString();
    const data = sanitizeForFirestore({
      logId,
      businessId: log.businessId,
      userId: log.userId || (log as any).actor || 'SYSTEM',
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata || {},
      timestamp: now,
    });

    await this.fallbackDb.createAuditLog(log);
    if (this.isFallbackMode) return { ...data, id: logId, actor: data.userId, createdAt: now };

    try {
      await serverDb.collection('auditLogs').doc(logId).set(data);
      return { ...data, id: logId, actor: data.userId, createdAt: now };
    } catch (err: any) {
      this.handlePermissionError(err);
      return { ...data, id: logId, actor: data.userId, createdAt: now };
    }
  }

  public async getAuditLogs(businessId: string, limitCount: number = 50): Promise<AuditLog[]> {
    if (this.isFallbackMode) return this.fallbackDb.getAuditLogs(businessId, limitCount);
    try {
      const snap = await serverDb.collection('auditLogs').where('businessId', '==', businessId).get();
      const list: AuditLog[] = [];
      snap.forEach(d => {
        const val = d.data();
        list.push({
          logId: d.id,
          id: d.id,
          businessId: val.businessId,
          userId: val.userId || val.actor || 'SYSTEM',
          actor: val.userId || val.actor || 'SYSTEM',
          action: val.action,
          entityType: val.entityType,
          entityId: val.entityId,
          metadata: val.metadata,
          timestamp: val.timestamp || val.createdAt,
          createdAt: val.timestamp || val.createdAt,
        });
      });
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return list.slice(0, limitCount);
    } catch (err: any) {
      if (this.handlePermissionError(err)) return this.fallbackDb.getAuditLogs(businessId, limitCount);
      return [];
    }
  }

  // Atomic Transaction Wrapper
  public async runInTransaction<T>(operation: (txStorage: IDatabaseStorage) => Promise<T>): Promise<T> {
    if (this.isFallbackMode) {
      return this.fallbackDb.runInTransaction(operation);
    }

    try {
      return await serverDb.runTransaction(async (fsTx: FsTransaction) => {
        const transactionalStorage: IDatabaseStorage = {
          getBusiness: (id: string) => this.getBusiness(id),
          getProduct: async (id: string) => {
            const productRef = serverDb.collection('products').doc(id);
            const snap = await fsTx.get(productRef);
            if (!snap.exists) return null;
            return this.formatProduct({ ...snap.data(), productId: snap.id });
          },
          getAllProducts: (businessId: string) => this.getAllProducts(businessId),
          createProduct: async (product) => {
            return this.createProduct(product);
          },
          updateProductStock: async (productId: string, newStock: number) => {
            const productRef = serverDb.collection('products').doc(productId);
            const now = new Date().toISOString();
            fsTx.update(productRef, {
              currentStock: newStock,
              updatedAt: now,
            });
            await this.fallbackDb.updateProductStock(productId, newStock);
            return {
              id: productId,
              productId,
              name: '',
              businessId: '',
              sku: '',
              unit: '',
              costPrice: 0,
              sellingPrice: 0,
              currentStock: newStock,
              minStockLevel: 5,
              createdAt: now,
              updatedAt: now,
            };
          },
          updateProduct: async (productId: string, updates: Partial<Product>) => {
            const productRef = serverDb.collection('products').doc(productId);
            const now = new Date().toISOString();
            const cleanUpdates = sanitizeForFirestore({ ...updates, updatedAt: now });
            fsTx.update(productRef, cleanUpdates);
            await this.fallbackDb.updateProduct(productId, updates);
            return { id: productId, productId, ...updates } as any;
          },
          createInventoryTransaction: async (tx) => {
            const txId = tx.transactionId || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const now = new Date().toISOString();
            const quantity = tx.quantity !== undefined ? tx.quantity : Math.abs(tx.quantityChange || 0);
            const newStock = tx.newStock !== undefined ? tx.newStock : (tx.resultingStock || 0);
            const previousStock = tx.previousStock !== undefined ? tx.previousStock : (newStock - (tx.quantityChange || quantity));

            const quantityChange = tx.quantityChange !== undefined ? tx.quantityChange : (tx.type === 'SALE' ? -quantity : quantity);

            const data = {
              transactionId: txId,
              businessId: tx.businessId,
              productId: tx.productId,
              type: tx.type,
              quantity,
              quantityChange,
              previousStock,
              newStock,
              unitCost: tx.unitCost !== undefined ? tx.unitCost : null,
              unitPrice: (tx as any).unitPrice !== undefined ? (tx as any).unitPrice : null,
              referenceId: tx.referenceId || `REF-${Date.now()}`,
              createdBy: tx.createdBy || 'SYSTEM',
              createdAt: now,
            };
            fsTx.set(serverDb.collection('inventoryTransactions').doc(txId), data);
            await this.fallbackDb.createInventoryTransaction({ ...data, productName: tx.productName, notes: tx.notes } as any);
            return this.formatTransaction({ ...data, productName: tx.productName, notes: tx.notes });
          },
          getInventoryTransactions: (bizId, lim) => this.getInventoryTransactions(bizId, lim),
          getInventoryTransactionsByProduct: (bizId, pId) => this.getInventoryTransactionsByProduct(bizId, pId),
          createSale: async (sale) => {
            const saleId = sale.saleId || `sale_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const now = new Date().toISOString();
            const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
            const total = Number(sale.total !== undefined ? sale.total : (sale.totalAmount || 0));

            const saleData = {
              saleId,
              businessId: sale.businessId,
              invoiceNumber,
              customerId: sale.customerId || null,
              subtotal: Number(sale.subtotal || total),
              discount: Number(sale.discount || 0),
              total,
              amountPaid: Number(sale.amountPaid !== undefined ? sale.amountPaid : total),
              balanceDue: Number(sale.balanceDue || 0),
              paymentStatus: sale.paymentStatus || 'PAID',
              paymentMethod: sale.paymentMethod || 'CASH',
              createdBy: sale.createdBy || 'SYSTEM',
              createdAt: now,
            };
            fsTx.set(serverDb.collection('sales').doc(saleId), saleData);

            const savedItems: SaleItem[] = [];
            if (sale.items && sale.items.length > 0) {
              for (const item of sale.items) {
                const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                const itemData = {
                  itemId,
                  saleId,
                  businessId: sale.businessId,
                  productId: item.productId,
                  productNameSnapshot: item.productNameSnapshot || item.productName || 'Product',
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  costPrice: item.costPrice || 0,
                  total: item.total !== undefined ? item.total : (item.subtotal || item.quantity * item.unitPrice),
                };
                fsTx.set(serverDb.collection('saleItems').doc(itemId), itemData);
                savedItems.push(itemData);
              }
            }
            await this.fallbackDb.createSale({ ...saleData, items: savedItems } as any);
            return this.formatSale(saleData, savedItems);
          },
          getSale: (saleIdOrInvoice: string) => this.getSale(saleIdOrInvoice),
          updateSale: async (saleId: string, updates: Partial<Sale>) => {
            const saleRef = serverDb.collection('sales').doc(saleId);
            const cleanUpdates = sanitizeForFirestore(updates);
            fsTx.update(saleRef, cleanUpdates);
            if (this.fallbackDb.updateSale) await this.fallbackDb.updateSale(saleId, updates);
            return { id: saleId, saleId, ...updates } as any;
          },
          getSales: (bizId, lim) => this.getSales(bizId, lim),
          getTodaySales: (bizId) => this.getTodaySales(bizId),
          getCustomer: async (id: string) => {
            const custRef = serverDb.collection('customers').doc(id);
            const snap = await fsTx.get(custRef);
            if (!snap.exists) return null;
            const current = snap.data() || {};
            return {
              customerId: snap.id,
              id: snap.id,
              businessId: current.businessId,
              name: current.name,
              phone: current.phone,
              balance: Number(current.balance || 0),
              totalPurchases: Number(current.totalPurchases || 0),
              createdAt: current.createdAt,
              updatedAt: current.updatedAt,
            };
          },
          getCustomers: (bizId) => this.getCustomers(bizId),
          findOrCreateCustomer: (bizId, name, phone) => this.findOrCreateCustomer(bizId, name, phone),
          getCustomerBalance: (bizId, nameOrId) => this.getCustomerBalance(bizId, nameOrId),
          updateCustomerBalance: async (customerId: string, balanceDelta: number, totalPurchasesDelta: number = 0, preloadedCustomer?: any) => {
            const custRef = serverDb.collection('customers').doc(customerId);
            let current = preloadedCustomer;
            if (!current) {
              const snap = await fsTx.get(custRef);
              if (!snap.exists) {
                throw new Error(`Customer "${customerId}" not found.`);
              }
              current = snap.data();
            }
            const newBalance = Math.max(0, Number(current.balance || 0) + balanceDelta);
            const newTotalPurchases = (Number(current.totalPurchases) || 0) + totalPurchasesDelta;
            const now = new Date().toISOString();
            fsTx.update(custRef, {
              balance: newBalance,
              totalPurchases: newTotalPurchases,
              updatedAt: now,
            });
            await this.fallbackDb.updateCustomerBalance(customerId, balanceDelta, totalPurchasesDelta, preloadedCustomer);
            return {
              customerId,
              id: customerId,
              businessId: current.businessId,
              name: current.name,
              phone: current.phone,
              balance: newBalance,
              totalPurchases: newTotalPurchases,
              createdAt: current.createdAt,
              updatedAt: now,
            };
          },
          recordPayment: async (payment: any) => {
            const paymentId = payment.paymentId || `pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const now = new Date().toISOString();
            const data: Payment = sanitizeForFirestore({
              paymentId,
              id: paymentId,
              businessId: payment.businessId,
              customerId: payment.customerId || null,
              saleId: payment.saleId || null,
              amount: payment.amount,
              method: payment.method || 'CASH',
              reference: payment.reference || `PAY-${Date.now()}`,
              recordedBy: payment.recordedBy || 'SYSTEM',
              createdAt: now,
            });
            fsTx.set(serverDb.collection('payments').doc(paymentId), data);
            await this.fallbackDb.recordPayment(data);
            return data;
          },
          getPayments: (bizId, lim) => this.getPayments(bizId, lim),
          createAuditLog: async (log) => {
            const logId = log.logId || `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const now = log.timestamp || new Date().toISOString();
            const data = sanitizeForFirestore({
              logId,
              businessId: log.businessId,
              userId: log.userId || (log as any).actor || 'SYSTEM',
              action: log.action,
              entityType: log.entityType,
              entityId: log.entityId,
              metadata: log.metadata || {},
              timestamp: now,
            });
            fsTx.set(serverDb.collection('auditLogs').doc(logId), data);
            await this.fallbackDb.createAuditLog(log);
            return { ...data, id: logId, actor: data.userId, createdAt: now };
          },
          getAuditLogs: (bizId, lim) => this.getAuditLogs(bizId, lim),
          runInTransaction: (op) => op(transactionalStorage),
          getIdempotentResult: (key: string) => this.getIdempotentResult(key),
          setIdempotentResult: (key: string, res: any, ttl?: number) => this.setIdempotentResult(key, res, ttl),
          resetDemoData: () => this.resetDemoData(),
        };

        return await operation(transactionalStorage);
      });
    } catch (err: any) {
      if (this.handlePermissionError(err)) {
        return this.fallbackDb.runInTransaction(operation);
      }
      throw err;
    }
  }

  // Idempotency
  public getIdempotentResult(key: string): any | null {
    const entry = this.idempotencyStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.idempotencyStore.delete(key);
      return null;
    }
    return entry.result;
  }

  public setIdempotentResult(key: string, result: any, ttlMs: number = 60000): void {
    this.idempotencyStore.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public async resetDemoData(targetBusinessId: string = 'biz_bello_01'): Promise<void> {
    await this.seedDemoCatalog(targetBusinessId);
  }

  /**
   * Migrate existing Indomie and demo catalog into Firebase for the specified business
   */
  public async seedDemoCatalog(businessId: string = 'biz_bello_01', ownerId: string = 'user_bello_01'): Promise<void> {
    const now = new Date().toISOString();
    
    // 1. Default Demo Products (Requirements: Indomie Super Pack carton stock = 45, etc.)
    const defaultCatalog = [
      {
        productId: 'prod_indomie_sup',
        name: 'Indomie Super Pack (Carton)',
        sku: 'IND-SUP-01',
        unit: 'carton',
        costPrice: 7500,
        sellingPrice: 8500,
        currentStock: 45,
        reorderLevel: 15,
      },
      {
        productId: 'prod_spaghetti_02',
        name: 'Golden Penny Spaghetti (Carton)',
        sku: 'GPS-CRT-02',
        unit: 'carton',
        costPrice: 11000,
        sellingPrice: 12500,
        currentStock: 20,
        reorderLevel: 8,
      },
      {
        productId: 'prod_milk_03',
        name: 'Peak Milk Powder (Tin 400g)',
        sku: 'PMK-TIN-03',
        unit: 'tin',
        costPrice: 2800,
        sellingPrice: 3200,
        currentStock: 12,
        reorderLevel: 10,
      },
      {
        productId: 'prod_sugar_04',
        name: 'Dangote Sugar (50kg Bag)',
        sku: 'DSG-BAG-04',
        unit: 'bag',
        costPrice: 62000,
        sellingPrice: 66000,
        currentStock: 4,
        reorderLevel: 5,
      },
      {
        productId: 'prod_milo_05',
        name: 'Milo Refill (500g Pack)',
        sku: 'MLO-RFL-05',
        unit: 'pack',
        costPrice: 2100,
        sellingPrice: 2500,
        currentStock: 35,
        reorderLevel: 12,
      },
    ];

    // Seed fallback DB
    for (const item of defaultCatalog) {
      const prodDocId = (businessId === 'biz_default' || businessId === 'biz_bello_01')
        ? item.productId
        : `${businessId}_${item.productId}`;
      await this.fallbackDb.createProduct({
        productId: prodDocId,
        businessId,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        currentStock: item.currentStock,
        reorderLevel: item.reorderLevel,
        active: true,
      } as any);
    }

    if (this.isFallbackMode) return;

    try {
      // 1. Business
      const bizRef = serverDb.collection('businesses').doc(businessId);
      const bizSnap = await bizRef.get();
      if (!bizSnap.exists) {
        await bizRef.set({
          businessId,
          name: 'Bello Provisions & Groceries',
          businessType: 'Retail & Wholesale Provisions',
          currency: 'NGN',
          currencySymbol: '₦',
          country: 'Nigeria',
          ownerId,
          createdAt: now,
          updatedAt: now,
        });
      }

      // 2. Default Demo Products
      for (const item of defaultCatalog) {
        const prodDocId = (businessId === 'biz_default' || businessId === 'biz_bello_01')
          ? item.productId
          : `${businessId}_${item.productId}`;
        const pRef = serverDb.collection('products').doc(prodDocId);
        await pRef.set({
          productId: prodDocId,
          businessId,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          costPrice: item.costPrice,
          sellingPrice: item.sellingPrice,
          currentStock: item.currentStock,
          reorderLevel: item.reorderLevel,
          active: true,
          createdAt: now,
          updatedAt: now,
        });

        // Add initial stock transaction
        const txId = `tx_init_${prodDocId}`;
        await serverDb.collection('inventoryTransactions').doc(txId).set({
          transactionId: txId,
          businessId,
          productId: prodDocId,
          type: 'STOCK_IN',
          quantity: item.currentStock,
          previousStock: 0,
          newStock: item.currentStock,
          unitCost: item.costPrice,
          referenceId: 'INITIAL_MIGRATION',
          createdBy: ownerId,
          createdAt: now,
        });
      }
    } catch (err: any) {
      this.handlePermissionError(err);
    }
  }
}

// Export singleton instance
export const firestoreDb = new FirestoreDatabaseStorage();
