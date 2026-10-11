import { 
  Business, 
  Product, 
  InventoryTransaction, 
  Sale, 
  Customer, 
  Payment,
  AuditLog 
} from '../types.ts';

export interface IDatabaseStorage {
  // Business
  getBusiness(id: string): Promise<Business | null>;
  createBusiness?(biz: any): Promise<Business>;
  
  // Products
  getProduct(id: string): Promise<Product | null>;
  getAllProducts(businessId: string): Promise<Product[]>;
  createProduct(product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product>;
  updateProductStock(productId: string, newStock: number): Promise<Product>;
  updateProduct(productId: string, updates: Partial<Product>): Promise<Product>;
  
  // Inventory
  createInventoryTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<InventoryTransaction>;
  getInventoryTransactions(businessId: string, limit?: number | string): Promise<InventoryTransaction[]>;
  getInventoryTransactionsByProduct?(businessId: string, productId: string): Promise<InventoryTransaction[]>;
  
  // Sales
  createSale(sale: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'>): Promise<Sale>;
  getSale?(saleIdOrInvoice: string): Promise<Sale | null>;
  updateSale?(saleId: string, updates: Partial<Sale>): Promise<Sale>;
  getSales(businessId: string, limit?: number): Promise<Sale[]>;
  getTodaySales(businessId: string): Promise<Sale[]>;
  
  // Customers
  getCustomer(id: string): Promise<Customer | null>;
  getCustomers?(businessId: string): Promise<Customer[]>;
  findOrCreateCustomer(businessId: string, name: string, phone?: string): Promise<Customer>;
  getCustomerBalance(businessId: string, nameOrId: string): Promise<{ customer: Customer | null; balance: number }>;
  updateCustomerBalance?(customerId: string, balanceDelta: number, totalPurchasesDelta?: number, preloadedCustomer?: any): Promise<Customer>;
  recordPayment(payment: any): Promise<Payment>;
  getPayments?(businessId: string, limit?: number): Promise<Payment[]>;
  
  // Audit
  createAuditLog(log: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog>;
  getAuditLogs(businessId: string, limit?: number): Promise<AuditLog[]>;
  
  // Atomic Transaction Wrapper
  runInTransaction<T>(operation: (txStorage: IDatabaseStorage) => Promise<T>): Promise<T>;
  
  // Idempotency & Duplicate Prevention
  getIdempotentResult(key: string): any | null;
  setIdempotentResult(key: string, result: any, ttlMs?: number): void;

  // Reset for Demo
  resetDemoData(): void;
}

// In-Memory Database with Atomic Locking & Snapshot Rollback Support
export class InMemoryDatabase implements IDatabaseStorage {
  private businesses: Map<string, Business> = new Map();
  private products: Map<string, Product> = new Map();
  private inventoryTransactions: InventoryTransaction[] = [];
  private sales: Sale[] = [];
  private customers: Map<string, Customer> = new Map();
  private payments: Payment[] = [];
  private auditLogs: AuditLog[] = [];
  private idempotencyStore: Map<string, { result: any; expiresAt: number }> = new Map();
  
  // Concurrency Lock for Atomic Isolation
  private lockPromise: Promise<void> = Promise.resolve();

  constructor() {
    this.seedDefaultData();
  }

  public seedDefaultData() {
    this.businesses.clear();
    this.products.clear();
    this.inventoryTransactions = [];
    this.sales = [];
    this.customers.clear();
    this.payments = [];
    this.auditLogs = [];
    this.idempotencyStore.clear();

    const now = new Date().toISOString();

    // Default SME Business
    const defaultBusiness: Business = {
      id: 'biz_default',
      businessId: 'biz_default',
      name: 'Bello Provisions & Groceries',
      businessType: 'Retail Provisions',
      country: 'Nigeria',
      ownerId: 'user_bello_01',
      ownerName: 'Alhaji Bello',
      phone: '+234 803 123 4567',
      currency: 'NGN',
      currencySymbol: '₦',
      createdAt: now,
      updatedAt: now,
    };
    this.businesses.set(defaultBusiness.id, defaultBusiness);

    // Initial SME Inventory
    const initialProducts: Product[] = [
      {
        id: 'prod_indomie_sup',
        productId: 'prod_indomie_sup',
        businessId: 'biz_default',
        name: 'Indomie Super Pack (Carton)',
        sku: 'IND-SUP-01',
        unit: 'carton',
        currentStock: 45,
        costPrice: 7500,
        sellingPrice: 8500,
        minStockLevel: 15,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'prod_golden_penny',
        productId: 'prod_golden_penny',
        businessId: 'biz_default',
        name: 'Golden Penny Spaghetti (Carton)',
        sku: 'GP-SPAG-01',
        unit: 'carton',
        currentStock: 20,
        costPrice: 12000,
        sellingPrice: 13500,
        minStockLevel: 10,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'prod_peak_milk',
        productId: 'prod_peak_milk',
        businessId: 'biz_default',
        name: 'Peak Evaporated Milk (Tin - Pack of 24)',
        sku: 'PEAK-EVAP-24',
        unit: 'pack',
        currentStock: 8,
        costPrice: 16500,
        sellingPrice: 18000,
        minStockLevel: 10,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'prod_dangote_sugar',
        productId: 'prod_dangote_sugar',
        businessId: 'biz_default',
        name: 'Dangote Refined Sugar (50kg Bag)',
        sku: 'DANG-SUG-50K',
        unit: 'bag',
        currentStock: 3,
        costPrice: 78000,
        sellingPrice: 84000,
        minStockLevel: 5,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'prod_milo_tin',
        productId: 'prod_milo_tin',
        businessId: 'biz_default',
        name: 'Nestle Milo (500g Tin - Roll of 6)',
        sku: 'MILO-500G-06',
        unit: 'roll',
        currentStock: 18,
        costPrice: 19000,
        sellingPrice: 21500,
        minStockLevel: 6,
        createdAt: now,
        updatedAt: now,
      }
    ];

    initialProducts.forEach(p => this.products.set(p.id, p));

    // Seed initial stock-in transaction logs
    initialProducts.forEach(p => {
      this.inventoryTransactions.push({
        id: `tx_init_${p.id}`,
        transactionId: `tx_init_${p.id}`,
        businessId: 'biz_default',
        productId: p.id,
        productName: p.name,
        type: 'INITIAL_STOCK',
        quantity: p.currentStock,
        quantityChange: p.currentStock,
        previousStock: 0,
        newStock: p.currentStock,
        resultingStock: p.currentStock,
        unitCost: p.costPrice,
        unitPrice: p.sellingPrice,
        referenceType: 'OPENING_BALANCE',
        referenceId: `REF-${p.sku}`,
        notes: 'Initial opening stock',
        createdBy: 'SYSTEM',
        createdAt: now,
      });
    });

    // Seed Demo Customers
    const defaultCustomer: Customer = {
      id: 'cust_mama_amaka',
      customerId: 'cust_mama_amaka',
      businessId: 'biz_default',
      name: 'Mama Amaka',
      phone: '+234 802 987 6543',
      balance: 15000,
      totalPurchases: 45000,
      totalPaid: 30000,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.set(defaultCustomer.customerId, defaultCustomer);

    const defaultCustomer2: Customer = {
      id: 'cust_musa_retail',
      customerId: 'cust_musa_retail',
      businessId: 'biz_default',
      name: 'Musa Retail',
      phone: '+234 818 555 1234',
      balance: 0,
      totalPurchases: 180000,
      totalPaid: 180000,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.set(defaultCustomer2.customerId, defaultCustomer2);
  }

  public resetDemoData(): void {
    this.seedDefaultData();
  }

  // Business
  public async getBusiness(id: string): Promise<Business | null> {
    const biz = this.businesses.get(id);
    return biz ? { ...biz } : null;
  }

  public async createBusiness(biz: Business): Promise<Business> {
    const id = biz.id || biz.businessId || `biz_${Date.now()}`;
    const item: Business = { ...biz, id, businessId: id };
    this.businesses.set(id, item);
    return { ...item };
  }

  // Products
  public async getProduct(id: string): Promise<Product | null> {
    const p = this.products.get(id);
    return p ? { ...p } : null;
  }

  public async getAllProducts(businessId: string): Promise<Product[]> {
    return Array.from(this.products.values())
      .filter(p => p.businessId === businessId)
      .map(p => ({ ...p }));
  }

  public async createProduct(productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
    const id = (productData as any).id || (productData as any).productId || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const newProduct: Product = {
      ...productData,
      id,
      productId: id,
      createdAt: (productData as any).createdAt || now,
      updatedAt: (productData as any).updatedAt || now,
    };
    this.products.set(id, newProduct);
    return { ...newProduct };
  }

  public async updateProductStock(productId: string, newStock: number): Promise<Product> {
    const p = this.products.get(productId);
    if (!p) throw new Error(`Product ${productId} not found`);
    if (newStock < 0) {
      throw new Error(`Insufficient stock for product ${p.name}. Stock cannot be negative.`);
    }
    p.currentStock = newStock;
    p.updatedAt = new Date().toISOString();
    this.products.set(productId, p);
    return { ...p };
  }

  public async updateProduct(productId: string, updates: Partial<Product>): Promise<Product> {
    const p = this.products.get(productId);
    if (!p) throw new Error(`Product ${productId} not found`);
    const updated = {
      ...p,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.products.set(productId, updated);
    return { ...updated };
  }

  // Inventory
  public async createInventoryTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<InventoryTransaction> {
    const id = (tx as any).id || (tx as any).transactionId || `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record: InventoryTransaction = {
      ...tx,
      id,
      transactionId: id,
      createdAt: (tx as any).createdAt || new Date().toISOString(),
    };
    this.inventoryTransactions.unshift(record);
    return { ...record };
  }

  public async getInventoryTransactions(businessId: string, limitCount?: number | string): Promise<InventoryTransaction[]> {
    const max = limitCount !== undefined ? Number(limitCount) : 50;
    return this.inventoryTransactions
      .filter(t => t.businessId === businessId)
      .slice(0, max)
      .map(t => ({ ...t }));
  }

  public async getInventoryTransactionsByProduct(businessId: string, productId: string): Promise<InventoryTransaction[]> {
    return this.inventoryTransactions
      .filter(t => t.businessId === businessId && t.productId === productId)
      .map(t => ({ ...t }));
  }

  // Sales
  public async createSale(saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt'>): Promise<Sale> {
    const id = (saleData as any).id || (saleData as any).saleId || `sale_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const invoiceNumber = (saleData as any).invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
    const record: Sale = {
      ...saleData,
      id,
      saleId: id,
      invoiceNumber,
      createdAt: (saleData as any).createdAt || new Date().toISOString(),
    };
    this.sales.unshift(record);
    return { ...record };
  }

  public async getSale(saleIdOrInvoice: string): Promise<Sale | null> {
    const s = this.sales.find(x => x.id === saleIdOrInvoice || (x as any).saleId === saleIdOrInvoice || x.invoiceNumber === saleIdOrInvoice);
    return s ? { ...s } : null;
  }

  public async updateSale(saleId: string, updates: Partial<Sale>): Promise<Sale> {
    const idx = this.sales.findIndex(s => s.id === saleId || (s as any).saleId === saleId);
    if (idx === -1) throw new Error(`Sale ${saleId} not found`);
    this.sales[idx] = { ...this.sales[idx], ...updates };
    return { ...this.sales[idx] };
  }

  public async getSales(businessId: string, limit: number = 50): Promise<Sale[]> {
    return this.sales
      .filter(s => s.businessId === businessId)
      .slice(0, limit)
      .map(s => ({ ...s }));
  }

  public async getTodaySales(businessId: string): Promise<Sale[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.sales
      .filter(s => s.businessId === businessId && s.createdAt.startsWith(today))
      .map(s => ({ ...s }));
  }

  // Customers
  public async getCustomer(id: string): Promise<Customer | null> {
    const c = this.customers.get(id);
    return c ? { ...c } : null;
  }

  public async getCustomers(businessId: string): Promise<Customer[]> {
    return Array.from(this.customers.values())
      .filter(c => c.businessId === businessId)
      .map(c => ({ ...c }));
  }

  public async findOrCreateCustomer(businessId: string, name: string, phone?: string): Promise<Customer> {
    const normalized = name.trim().toLowerCase();
    for (const c of this.customers.values()) {
      if (c.businessId === businessId && c.name.toLowerCase() === normalized) {
        return { ...c };
      }
    }
    const id = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newCust: Customer = {
      id,
      customerId: id,
      businessId,
      name: name.trim(),
      phone,
      balance: 0,
      totalPurchases: 0,
      totalPaid: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.customers.set(id, newCust);
    return { ...newCust };
  }

  public async updateCustomerBalance(customerId: string, balanceDelta: number, totalPurchasesDelta: number = 0, _preloadedCustomer?: any): Promise<Customer> {
    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new Error(`Customer "${customerId}" not found.`);
    }
    customer.balance = Math.max(0, customer.balance + balanceDelta);
    if (totalPurchasesDelta !== 0) {
      customer.totalPurchases = (customer.totalPurchases || 0) + totalPurchasesDelta;
    }
    customer.updatedAt = new Date().toISOString();
    return { ...customer };
  }

  public async getCustomerBalance(businessId: string, nameOrId: string): Promise<{ customer: Customer | null; balance: number }> {
    const customer = await this.findOrCreateCustomer(businessId, nameOrId);
    return {
      customer,
      balance: customer ? customer.balance : 0,
    };
  }

  public async recordPayment(payment: any): Promise<Payment> {
    const paymentId = payment.id || payment.paymentId || `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const record: Payment = {
      id: paymentId,
      paymentId,
      businessId: payment.businessId,
      customerId: payment.customerId,
      saleId: payment.saleId,
      amount: payment.amount,
      method: payment.method || 'CASH',
      reference: payment.reference || `PAY-${Date.now()}`,
      recordedBy: payment.recordedBy || 'SYSTEM',
      createdAt: payment.createdAt || new Date().toISOString(),
    };
    this.payments.unshift(record);
    return { ...record };
  }

  public async getPayments(businessId: string, limit: number = 50): Promise<Payment[]> {
    return this.payments
      .filter(p => p.businessId === businessId)
      .slice(0, limit)
      .map(p => ({ ...p }));
  }

  public async createAuditLog(logData: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog> {
    const id = (logData as any).id || (logData as any).logId || `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const log: AuditLog = {
      ...logData,
      id,
      createdAt: (logData as any).createdAt || new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    return { ...log };
  }

  public async getAuditLogs(businessId: string, limit: number = 50): Promise<AuditLog[]> {
    return this.auditLogs
      .filter(a => a.businessId === businessId)
      .slice(0, limit)
      .map(a => ({ ...a }));
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

  public setIdempotentResult(key: string, result: any, ttlMs: number = 86400000): void {
    this.idempotencyStore.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });
  }

  // Concurrency & Atomic Transaction Implementation
  public async runInTransaction<T>(operation: (txStorage: IDatabaseStorage) => Promise<T>): Promise<T> {
    const acquireLock = () => {
      let releaseLock: () => void;
      const nextLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const previousLock = this.lockPromise;
      this.lockPromise = this.lockPromise.then(() => nextLock);
      return previousLock.then(() => releaseLock);
    };

    const release = await acquireLock();

    // Snapshot state for atomic rollback on failure
    const snapshot = {
      businesses: new Map(this.businesses),
      products: new Map(Array.from(this.products.entries()).map(([k, v]) => [k, { ...v }])),
      inventoryTransactions: [...this.inventoryTransactions],
      sales: [...this.sales],
      customers: new Map(Array.from(this.customers.entries()).map(([k, v]) => [k, { ...v }])),
      payments: [...this.payments],
      auditLogs: [...this.auditLogs],
      idempotencyStore: new Map(this.idempotencyStore),
    };

    try {
      const result = await operation(this);
      return result;
    } catch (error) {
      // Rollback on failure
      this.businesses = snapshot.businesses;
      this.products = snapshot.products;
      this.inventoryTransactions = snapshot.inventoryTransactions;
      this.sales = snapshot.sales;
      this.customers = snapshot.customers;
      this.payments = snapshot.payments;
      this.auditLogs = snapshot.auditLogs;
      this.idempotencyStore = snapshot.idempotencyStore;
      throw error;
    } finally {
      release();
    }
  }
}
