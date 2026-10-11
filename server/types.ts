export interface Business {
  id: string;
  businessId: string;
  name: string;
  businessType: string;
  currency: string;
  country: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  // Legacy / convenience aliases
  ownerName?: string;
  phone?: string;
  currencySymbol?: string;
}

export interface UserProfile {
  userId: string;
  email: string;
  name: string;
  businessId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  productId?: string;
  businessId: string;
  name: string;
  sku: string;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  currentStock: number;
  minStockLevel: number;
  reorderLevel?: number;
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InventoryTransactionType = 
  | 'STOCK_IN' 
  | 'SALE' 
  | 'SALE_RETURN'
  | 'ADJUSTMENT_IN' 
  | 'ADJUSTMENT_OUT' 
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RETURN'
  | 'INITIAL_STOCK';

export interface InventoryTransaction {
  transactionId?: string;
  id?: string;
  businessId: string;
  productId: string;
  locationId?: string;
  type: InventoryTransactionType;
  transactionType?: InventoryTransactionType;
  quantity: number;
  quantityChange?: number;
  previousStock: number;
  previousBalance?: number;
  newStock: number;
  newBalance?: number;
  resultingStock?: number;
  unitCost?: number | null;
  unitPrice?: number | null;
  referenceId: string;
  referenceType?: string;
  createdBy: string;
  createdAt: string;
  productName?: string;
  notes?: string;
}

export type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'POS' | 'CREDIT';

export interface SaleItem {
  itemId?: string;
  saleId?: string;
  businessId?: string;
  productId: string;
  productNameSnapshot?: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  total?: number;
  productName?: string;
  unit?: string;
  subtotal?: number;
}

export interface Sale {
  id?: string;
  saleId?: string;
  businessId: string;
  invoiceNumber: string;
  customerId?: string;
  customerName?: string;
  items?: SaleItem[];
  subtotal?: number;
  discount?: number;
  total?: number;
  totalAmount?: number;
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  notes?: string;
  createdBy: string;
  salesperson?: string;
  createdAt: string;
}

export interface Customer {
  id?: string;
  customerId: string;
  businessId: string;
  name: string;
  phone?: string;
  balance: number;
  totalPurchases?: number;
  totalPaid?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Payment {
  id?: string;
  paymentId: string;
  businessId: string;
  customerId?: string;
  saleId?: string;
  amount: number;
  method: string;
  reference: string;
  recordedBy: string;
  createdAt: string;
}

export type AuditAction = 
  | 'PRODUCT_CREATED'
  | 'STOCK_ADDED'
  | 'STOCK_ADJUSTED'
  | 'SALE_CREATED'
  | 'SALE_CANCELLED'
  | 'PRODUCT_UPDATED'
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_UPDATED'
  | 'PAYMENT_RECORDED'
  | 'PRODUCT_INITIALIZED'
  | 'STOCK_DEDUCTED_SALE'
  | 'INVENTORY_RECONCILED';

export interface AuditLog {
  id?: string;
  logId?: string;
  businessId: string;
  userId: string;
  actor?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, any>;
  beforeState?: Record<string, any> | null;
  afterState?: Record<string, any> | null;
  source?: 'WEB' | 'CHAT' | 'WHATSAPP' | 'SYSTEM';
  timestamp: string;
  createdAt?: string;
}

export interface DashboardSummary {
  totalProducts: number;
  currentInventoryValue: number;
  todaySalesRevenue: number;
  todaySalesCount: number;
  lowStockCount: number;
  lowStockProducts: Product[];
  recentTransactions: InventoryTransaction[];
  recentSales: Sale[];
  currencySymbol: string;
  currency: string;
  businessName: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  structuredData?: {
    type: 'SALE_RECEIPT' | 'STOCK_CONFIRMATION' | 'STOCK_QUERY' | 'SALES_SUMMARY' | 'LOW_STOCK_ALERT' | 'CUSTOMER_BALANCE' | 'PAYMENT_RECEIPT' | 'CLARIFICATION_NEEDED' | 'ERROR';
    sale?: Sale;
    transaction?: InventoryTransaction;
    product?: Product;
    products?: Product[];
    customer?: Customer;
    payment?: Payment;
    todaySales?: {
      total: number;
      count: number;
      items: { name: string; quantity: number; unit: string; total: number }[];
    };
    suggestedActions?: string[];
  };
}

export interface ParsedIntentResult {
  functionCall: 'createProduct' | 'addStock' | 'getStock' | 'recordSale' | 'getSales' | 'getLowStock' | 'createCustomer' | 'getCustomerBalance' | 'recordPayment' | 'clarification' | 'unknown';
  confidence: number;
  parameters: {
    productNameQuery?: string;
    productId?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    totalAmount?: number;
    customerName?: string;
    phone?: string;
    unitCost?: number;
    reorderLevel?: number;
    costPrice?: number;
    sellingPrice?: number;
    paymentAmount?: number;
    paymentMethod?: PaymentMethod;
    clarificationPrompt?: string;
  };
  reasoning?: string;
}
