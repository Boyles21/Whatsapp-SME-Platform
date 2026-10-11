import { db, IDatabaseStorage } from '../../db/storage.ts';
import { Sale, SaleItem, Product, InventoryTransaction, Customer } from '../../types.ts';
import { InventoryService } from '../inventory/index.ts';
import { AuditService } from '../audit/index.ts';
import { CustomerService } from '../customers/index.ts';

export interface RecordSaleItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

export interface RecordSaleResult {
  sale: Sale;
  inventoryTransactions: InventoryTransaction[];
  updatedProducts: Product[];
}

export class SalesService {
  /**
   * Records a sale atomically.
   * Validates all product stock balances BEFORE committing.
   * If any item exceeds available stock, the entire transaction rolls back!
   * Handles cash, partial, and credit sales.
   * Updates customer debt balance if credit or partial.
   * Creates sale record, inventory transactions, customer record, and audit log.
   */
  public static async recordSale(
    businessId: string,
    actor: string,
    params: {
      items: RecordSaleItemInput[];
      customerName?: string;
      customerPhone?: string;
      notes?: string;
      totalAmountOverride?: number;
      amountPaid?: number;
      paymentMethod?: 'CASH' | 'TRANSFER' | 'CREDIT' | 'POS';
    }
  ): Promise<RecordSaleResult> {
    // Customer resolution (done before transaction to prevent write-before-read in Firestore)
    const customer = await CustomerService.resolveCustomer(
      db,
      businessId,
      params.customerName,
      params.customerPhone
    );

    return db.runInTransaction(async (txStorage: IDatabaseStorage) => {
      if (!params.items || params.items.length === 0) {
        throw new Error('Sale must contain at least one item.');
      }

      // Pre-fetch all products and validate quantities (ALL READS FIRST)
      const resolvedItems: SaleItem[] = [];
      const productMap = new Map<string, Product>();
      let calculatedTotal = 0;

      for (const itemInput of params.items) {
        if (!itemInput.productId) {
          throw new Error('Missing product ID in sale item.');
        }
        if (typeof itemInput.quantity !== 'number' || itemInput.quantity <= 0) {
          throw new Error(`Invalid quantity (${itemInput.quantity}). Must be greater than 0.`);
        }

        const product = await txStorage.getProduct(itemInput.productId);
        if (!product || product.businessId !== businessId) {
          throw new Error(`Product ID "${itemInput.productId}" not found.`);
        }

        if (product.currentStock < itemInput.quantity) {
          throw new Error(
            `Insufficient stock for "${product.name}". Available: ${product.currentStock} ${product.unit}(s), Requested: ${itemInput.quantity} ${product.unit}(s). Cannot record sale.`
          );
        }

        productMap.set(product.id, product);

        const unitPrice = itemInput.unitPrice !== undefined ? itemInput.unitPrice : product.sellingPrice;
        const subtotal = itemInput.quantity * unitPrice;

        calculatedTotal += subtotal;
        resolvedItems.push({
          productId: product.id,
          productName: product.name,
          quantity: itemInput.quantity,
          unit: product.unit,
          unitPrice,
          subtotal,
        });
      }

      // Pre-fetch customer within the transaction (ALL READS MUST PRECEDE WRITES)
      let liveCustomer: Customer | null = null;
      if (customer) {
        const custId = customer.customerId || customer.id || '';
        liveCustomer = await txStorage.getCustomer(custId);
      }

      // Total amount (can use override if provided e.g. "for 42500" lump sum for the batch)
      const finalTotal = params.totalAmountOverride !== undefined ? params.totalAmountOverride : calculatedTotal;

      // Determine payment calculations
      const paymentMethod = params.paymentMethod || (params.amountPaid === 0 ? 'CREDIT' : 'CASH');
      const amountPaid = params.amountPaid !== undefined ? Math.max(0, params.amountPaid) : (paymentMethod === 'CREDIT' ? 0 : finalTotal);
      const balanceDue = Math.max(0, finalTotal - amountPaid);
      let paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID' = 'PAID';
      if (amountPaid === 0 && finalTotal > 0) {
        paymentStatus = 'UNPAID';
      } else if (balanceDue > 0) {
        paymentStatus = 'PARTIAL';
      }

      // ALL WRITES START HERE (No more reads allowed inside this Firestore transaction)
      // 1. Create Sale Record
      const sale = await txStorage.createSale({
        businessId,
        customerId: customer?.id || (customer as any)?.customerId,
        customerName: customer?.name || params.customerName || 'Walk-in Customer',
        items: resolvedItems,
        totalAmount: finalTotal,
        total: finalTotal,
        subtotal: calculatedTotal,
        amountPaid,
        balanceDue,
        paymentStatus,
        paymentMethod,
        createdBy: actor,
        notes: params.notes || 'WhatsApp Instant Sale',
      });

      // Update customer balance and purchase totals if customer is identified (using pre-read customer)
      if (customer && txStorage.updateCustomerBalance) {
        const custId = customer.customerId || customer.id || '';
        await txStorage.updateCustomerBalance(custId, balanceDue, finalTotal, liveCustomer || customer);
      }

      // Record payment if any initial amount was collected
      if (amountPaid > 0 && txStorage.recordPayment) {
        const custId = customer ? (customer.customerId || customer.id) : undefined;
        await txStorage.recordPayment({
          businessId,
          customerId: custId,
          amount: amountPaid,
          method: paymentMethod === 'CREDIT' ? 'CASH' : paymentMethod,
          reference: `INV-${sale.invoiceNumber}`,
          recordedBy: actor,
        });
      }

      // 2. Deduct stock for each item atomically & create inventory transactions (using pre-read productSnapshot)
      const inventoryTransactions: InventoryTransaction[] = [];
      const updatedProducts: Product[] = [];

      for (const item of resolvedItems) {
        const productSnapshot = productMap.get(item.productId);
        const { product: updatedProd, transaction: tx } = await InventoryService.deductStockForSale(
          txStorage,
          businessId,
          actor,
          {
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            saleId: sale.invoiceNumber,
            productSnapshot,
          }
        );
        inventoryTransactions.push(tx);
        updatedProducts.push(updatedProd);
      }

      // Record Audit Record for Sale
      await AuditService.recordLog(txStorage, {
        businessId,
        actor,
        action: 'SALE_CREATED',
        entityType: 'SALE',
        entityId: sale.id || sale.saleId || sale.invoiceNumber,
        beforeState: null,
        afterState: sale,
        metadata: {
          invoiceNumber: sale.invoiceNumber,
          totalAmount: sale.total,
          amountPaid,
          balanceDue,
          paymentStatus,
          itemCount: sale.items?.length || 0,
          customer: sale.customerName || 'Walk-in Customer',
        },
      });

      return {
        sale,
        inventoryTransactions,
        updatedProducts,
      };
    });
  }

  /**
   * Cancels a sale atomically.
   * Restores inventory for all items in the sale with SALE_RETURN transactions.
   * Reverts customer debt balance if sale was on credit/partial.
   * Updates sale status to CANCELLED.
   * Records audit log.
   */
  public static async cancelSale(
    businessId: string,
    actor: string,
    saleIdOrInvoice: string,
    reason?: string
  ): Promise<{ sale: Sale; restoredProducts: Product[] }> {
    return db.runInTransaction(async (txStorage: IDatabaseStorage) => {
      const sale = txStorage.getSale ? await txStorage.getSale(saleIdOrInvoice) : null;
      if (!sale || sale.businessId !== businessId) {
        throw new Error(`Sale with ID/Invoice "${saleIdOrInvoice}" not found.`);
      }

      if (sale.paymentStatus === 'CANCELLED') {
        throw new Error(`Sale "${sale.invoiceNumber}" is already cancelled.`);
      }

      const restoredProducts: Product[] = [];

      // Restore inventory
      if (sale.items && Array.isArray(sale.items)) {
        for (const item of sale.items) {
          const product = await txStorage.getProduct(item.productId);
          if (product) {
            const previousStock = product.currentStock;
            const newStock = previousStock + item.quantity;
            const updated = await txStorage.updateProductStock(product.id, newStock);
            restoredProducts.push(updated);

            await txStorage.createInventoryTransaction({
              businessId,
              productId: product.id,
              productName: product.name,
              type: 'SALE_RETURN',
              quantity: item.quantity,
              previousStock,
              newStock,
              quantityChange: item.quantity,
              resultingStock: newStock,
              referenceType: 'RETURN',
              referenceId: sale.invoiceNumber,
              createdBy: actor,
              notes: `Stock returned from cancelled sale ${sale.invoiceNumber}. Reason: ${reason || 'Sale cancellation'}`,
            });
          }
        }
      }

      // Revert customer debt if applicable
      const balanceDue = Number(sale.balanceDue || 0);
      if (sale.customerId && balanceDue > 0 && txStorage.updateCustomerBalance) {
        await txStorage.updateCustomerBalance(sale.customerId, -balanceDue, -Number(sale.total || sale.totalAmount || 0));
      }

      // Mark sale cancelled
      const targetSaleId = sale.id || sale.saleId || sale.invoiceNumber;
      const updatedSale = txStorage.updateSale
        ? await txStorage.updateSale(targetSaleId, {
            paymentStatus: 'CANCELLED',
            notes: `${sale.notes || ''} [CANCELLED: ${reason || 'Customer request'}]`.trim(),
          })
        : { ...sale, paymentStatus: 'CANCELLED' as const };

      await AuditService.recordLog(txStorage, {
        businessId,
        actor,
        action: 'SALE_CANCELLED',
        entityType: 'SALE',
        entityId: sale.id || sale.saleId || sale.invoiceNumber,
        beforeState: sale,
        afterState: updatedSale,
        metadata: {
          invoiceNumber: sale.invoiceNumber,
          reason,
          restoredItemsCount: sale.items?.length || 0,
        },
      });

      return { sale: updatedSale, restoredProducts };
    });
  }

  public static async getTodaySales(businessId: string): Promise<{
    sales: Sale[];
    totalRevenue: number;
    totalCount: number;
    itemsSummary: { name: string; quantity: number; unit: string; total: number }[];
  }> {
    const sales = await db.getTodaySales(businessId);
    const totalRevenue = sales.reduce((sum, s) => sum + (s.totalAmount || s.total || 0), 0);

    // Aggregate items
    const itemsMap = new Map<string, { name: string; quantity: number; unit: string; total: number }>();
    for (const sale of sales) {
      if (sale.items && Array.isArray(sale.items)) {
        for (const item of sale.items) {
          const prodName = item.productName || item.productNameSnapshot || 'Product';
          const existing = itemsMap.get(item.productId) || {
            name: prodName,
            quantity: 0,
            unit: item.unit || 'unit',
            total: 0,
          };
          existing.quantity += item.quantity;
          existing.total += item.subtotal || item.total || (item.quantity * item.unitPrice);
          itemsMap.set(item.productId, existing);
        }
      }
    }

    return {
      sales,
      totalRevenue,
      totalCount: sales.length,
      itemsSummary: Array.from(itemsMap.values()),
    };
  }

  public static async getSalesHistory(businessId: string, limit: number = 50): Promise<Sale[]> {
    return db.getSales(businessId, limit);
  }

  public static async getSalesReport(businessId: string, limit: number = 100) {
    const sales = await db.getSales(businessId, limit);
    const completedSales = sales.filter(s => s.paymentStatus !== 'CANCELLED');
    const totalRevenue = completedSales.reduce((acc, s) => acc + (Number(s.total || s.totalAmount) || 0), 0);
    const totalCashCollected = completedSales.reduce((acc, s) => acc + (Number(s.amountPaid) || 0), 0);
    const totalOutstandingCredit = completedSales.reduce((acc, s) => acc + (Number(s.balanceDue) || 0), 0);

    const cancelledCount = sales.filter(s => s.paymentStatus === 'CANCELLED').length;
    const paidCount = sales.filter(s => s.paymentStatus === 'PAID').length;
    const partialCount = sales.filter(s => s.paymentStatus === 'PARTIAL').length;
    const unpaidCount = sales.filter(s => s.paymentStatus === 'UNPAID').length;

    return {
      totalSalesCount: completedSales.length,
      cancelledSalesCount: cancelledCount,
      totalRevenue,
      totalCashCollected,
      totalOutstandingCredit,
      paymentBreakdown: {
        paid: paidCount,
        partial: partialCount,
        unpaid: unpaidCount,
        cancelled: cancelledCount,
      },
      recentSales: sales.slice(0, 10),
    };
  }
}
