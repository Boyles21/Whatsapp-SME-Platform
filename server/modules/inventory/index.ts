import { db, IDatabaseStorage } from '../../db/storage.ts';
import { InventoryTransaction, Product } from '../../types.ts';
import { AuditService } from '../audit/index.ts';

export class InventoryService {
  /**
   * Adds stock atomically.
   * Validates quantity > 0.
   * Creates an inventory transaction.
   * Records an audit log.
   */
  public static async addStock(
    businessId: string,
    actor: string,
    params: {
      productId: string;
      quantity: number;
      unitCost?: number;
      notes?: string;
      referenceId?: string;
    }
  ): Promise<{ product: Product; transaction: InventoryTransaction }> {
    return db.runInTransaction(async (txStorage: IDatabaseStorage) => {
      // 1. Validation
      if (!params.productId) {
        throw new Error('Product ID is required to add stock.');
      }
      if (typeof params.quantity !== 'number' || isNaN(params.quantity) || params.quantity <= 0) {
        throw new Error(`Invalid quantity (${params.quantity}). Quantity to add must be a positive number greater than zero.`);
      }

      const product = await txStorage.getProduct(params.productId);
      if (!product || product.businessId !== businessId) {
        throw new Error(`Product with ID "${params.productId}" does not exist in your catalog.`);
      }

      const previousStock = product.currentStock;
      const newStock = previousStock + params.quantity;

      // 2. Update stock
      const updatedProduct = await txStorage.updateProductStock(product.id, newStock);

      // 3. Create Inventory Transaction
      const inventoryTx = await txStorage.createInventoryTransaction({
        businessId,
        productId: product.id,
        productName: product.name,
        type: 'STOCK_IN',
        quantity: params.quantity,
        previousStock,
        newStock,
        quantityChange: params.quantity,
        resultingStock: newStock,
        unitCost: params.unitCost !== undefined ? params.unitCost : product.costPrice,
        referenceType: 'MANUAL_IN',
        referenceId: params.referenceId || `BATCH-${Date.now()}`,
        createdBy: actor,
        notes: params.notes || `Stock added via WhatsApp Assistant (+${params.quantity} ${product.unit}s)`,
      });

      const txId = inventoryTx.transactionId || inventoryTx.id || `tx_${Date.now()}`;

      // 4. Audit Record
      await AuditService.recordLog(txStorage, {
        businessId,
        actor,
        action: 'STOCK_ADDED',
        entityType: 'INVENTORY',
        entityId: txId,
        beforeState: { currentStock: previousStock },
        afterState: { currentStock: newStock, quantityAdded: params.quantity },
        metadata: {
          productId: product.id,
          productName: product.name,
          unitCost: params.unitCost,
          transactionId: txId,
        },
      });

      return { product: updatedProduct, transaction: inventoryTx };
    });
  }

  /**
   * Deducts stock for a sale atomically within a transactional boundary.
   * Strictly enforces: Stock must NEVER become negative!
   */
  public static async deductStockForSale(
    txStorage: IDatabaseStorage,
    businessId: string,
    actor: string,
    params: {
      productId: string;
      quantity: number;
      unitPrice: number;
      saleId: string;
      productSnapshot?: Product;
    }
  ): Promise<{ product: Product; transaction: InventoryTransaction }> {
    if (!params.productId) {
      throw new Error('Product ID is required for stock deduction.');
    }
    if (typeof params.quantity !== 'number' || isNaN(params.quantity) || params.quantity <= 0) {
      throw new Error(`Invalid sale quantity (${params.quantity}). Must be greater than zero.`);
    }

    const product = params.productSnapshot || await txStorage.getProduct(params.productId);
    if (!product || product.businessId !== businessId) {
      throw new Error(`Product with ID "${params.productId}" not found.`);
    }

    const currentStock = product.currentStock;
    if (currentStock < params.quantity) {
      throw new Error(
        `Insufficient stock for "${product.name}". You only have ${currentStock} ${product.unit}(s) in stock, but tried to sell ${params.quantity}. Stock cannot be negative.`
      );
    }

    const newStock = currentStock - params.quantity;
    const updatedProduct = await txStorage.updateProductStock(product.id, newStock);
    const resolvedProduct = { ...product, currentStock: newStock };

    const inventoryTx = await txStorage.createInventoryTransaction({
      businessId,
      productId: product.id,
      productName: product.name,
      type: 'SALE',
      quantity: params.quantity,
      previousStock: currentStock,
      newStock: newStock,
      quantityChange: -params.quantity,
      resultingStock: newStock,
      unitPrice: params.unitPrice,
      referenceType: 'SALE',
      referenceId: params.saleId,
      createdBy: actor,
      notes: `Sold ${params.quantity} ${product.unit}(s) under invoice ${params.saleId}`,
    });

    const saleTxId = inventoryTx.transactionId || inventoryTx.id || `tx_${Date.now()}`;

    await AuditService.recordLog(txStorage, {
      businessId,
      actor,
      action: 'STOCK_DEDUCTED_SALE',
      entityType: 'INVENTORY',
      entityId: saleTxId,
      beforeState: { currentStock },
      afterState: { currentStock: newStock, quantityDeducted: params.quantity },
      metadata: {
        productId: product.id,
        saleId: params.saleId,
        unitPrice: params.unitPrice,
      },
    });

    return { product: resolvedProduct, transaction: inventoryTx };
  }

  public static async getProductBalance(productId: string): Promise<Product | null> {
    return db.getProduct(productId);
  }

  public static async getStock(businessId: string, productId: string): Promise<{ product: Product; currentStock: number }> {
    const product = await db.getProduct(productId);
    if (!product || product.businessId !== businessId) {
      throw new Error(`Product with ID "${productId}" not found.`);
    }
    return { product, currentStock: product.currentStock };
  }

  public static async getAuthoritativeStock(businessId: string, productId: string): Promise<number> {
    const product = await db.getProduct(productId);
    if (!product || product.businessId !== businessId) {
      throw new Error(`Product with ID "${productId}" not found.`);
    }
    return product.currentStock;
  }

  /**
   * Adjusts stock level manually (e.g. inventory audit count, wastage, breakage, correction).
   * Atomically records ADJUSTMENT_IN or ADJUSTMENT_OUT.
   * Strictly prevents stock from going below 0.
   */
  public static async adjustStock(
    businessId: string,
    actor: string,
    params: {
      productId: string;
      adjustment: number;
      reason?: string;
      notes?: string;
    }
  ): Promise<{ product: Product; transaction: InventoryTransaction }> {
    return db.runInTransaction(async (txStorage: IDatabaseStorage) => {
      if (!params.productId) {
        throw new Error('Product ID is required for stock adjustment.');
      }
      if (typeof params.adjustment !== 'number' || isNaN(params.adjustment) || params.adjustment === 0) {
        throw new Error(`Invalid adjustment quantity (${params.adjustment}). Must be a non-zero number.`);
      }

      const product = await txStorage.getProduct(params.productId);
      if (!product || product.businessId !== businessId) {
        throw new Error(`Product with ID "${params.productId}" not found.`);
      }

      const previousStock = product.currentStock;
      const newStock = previousStock + params.adjustment;

      if (newStock < 0) {
        throw new Error(
          `Cannot adjust stock by ${params.adjustment} for "${product.name}". Current stock is ${previousStock}, which would result in negative stock (${newStock}).`
        );
      }

      const updatedProduct = await txStorage.updateProductStock(product.id, newStock);

      const type = params.adjustment > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      const absQty = Math.abs(params.adjustment);

      const inventoryTx = await txStorage.createInventoryTransaction({
        businessId,
        productId: product.id,
        productName: product.name,
        type,
        quantity: absQty,
        previousStock,
        newStock,
        quantityChange: params.adjustment,
        resultingStock: newStock,
        referenceType: 'ADJUSTMENT',
        referenceId: `ADJ-${Date.now()}`,
        createdBy: actor,
        notes: params.notes || params.reason || `Stock adjustment (${params.adjustment > 0 ? '+' : ''}${params.adjustment} ${product.unit}s)`,
      });

      const txId = inventoryTx.transactionId || inventoryTx.id || `tx_${Date.now()}`;

      await AuditService.recordLog(txStorage, {
        businessId,
        actor,
        action: 'STOCK_ADJUSTED',
        entityType: 'INVENTORY',
        entityId: txId,
        beforeState: { currentStock: previousStock },
        afterState: { currentStock: newStock, adjustment: params.adjustment },
        metadata: {
          productId: product.id,
          reason: params.reason,
          notes: params.notes,
        },
      });

      return { product: updatedProduct, transaction: inventoryTx };
    });
  }

  /**
   * Reconciles authoritative current stock against the immutable transaction ledger.
   * Detects variances without mutating current stock.
   */
  public static async reconcileInventory(
    businessId: string,
    targetProductId?: string
  ): Promise<{
    totalAudited: number;
    matchedCount: number;
    discrepancyCount: number;
    discrepancies: Array<{
      productId: string;
      productName: string;
      currentStock: number;
      calculatedFromLedger: number;
      variance: number;
      transactionsCount: number;
    }>;
    timestamp: string;
  }> {
    const products = await db.getAllProducts(businessId);
    const auditedProducts = targetProductId ? products.filter(p => p.id === targetProductId) : products;

    const discrepancies: Array<{
      productId: string;
      productName: string;
      currentStock: number;
      calculatedFromLedger: number;
      variance: number;
      transactionsCount: number;
    }> = [];

    let matchedCount = 0;

    for (const product of auditedProducts) {
      const txs = db.getInventoryTransactionsByProduct 
        ? await db.getInventoryTransactionsByProduct(businessId, product.id)
        : (await db.getInventoryTransactions(businessId, 500)).filter(t => t.productId === product.id);

      // Sum all ledger entries
      let ledgerStock = 0;
      for (const tx of txs) {
        if (tx.quantityChange !== undefined) {
          ledgerStock += tx.quantityChange;
        } else {
          switch (tx.type) {
            case 'STOCK_IN':
            case 'INITIAL_STOCK':
            case 'SALE_RETURN':
            case 'ADJUSTMENT_IN':
            case 'TRANSFER_IN':
              ledgerStock += tx.quantity;
              break;
            case 'SALE':
            case 'ADJUSTMENT_OUT':
            case 'TRANSFER_OUT':
              ledgerStock -= tx.quantity;
              break;
            default:
              ledgerStock += tx.quantity;
          }
        }
      }

      const variance = product.currentStock - ledgerStock;
      if (Math.abs(variance) > 0.0001 && txs.length > 0) {
        discrepancies.push({
          productId: product.id,
          productName: product.name,
          currentStock: product.currentStock,
          calculatedFromLedger: ledgerStock,
          variance,
          transactionsCount: txs.length,
        });
      } else {
        matchedCount++;
      }
    }

    return {
      totalAudited: auditedProducts.length,
      matchedCount,
      discrepancyCount: discrepancies.length,
      discrepancies,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generates comprehensive inventory report.
   */
  public static async getInventoryReport(businessId: string) {
    const products = await db.getAllProducts(businessId);
    const lowStock = products.filter(p => p.currentStock <= p.minStockLevel);
    const outOfStock = products.filter(p => p.currentStock <= 0);

    const items = products.map(p => {
      const costValue = p.currentStock * p.costPrice;
      const retailValue = p.currentStock * p.sellingPrice;
      const potentialProfit = retailValue - costValue;
      let status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' = 'IN_STOCK';
      if (p.currentStock <= 0) status = 'OUT_OF_STOCK';
      else if (p.currentStock <= p.minStockLevel) status = 'LOW_STOCK';

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        currentStock: p.currentStock,
        minStockLevel: p.minStockLevel,
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        costValue,
        retailValue,
        potentialProfit,
        status,
      };
    });

    const totalCostValue = items.reduce((acc, i) => acc + i.costValue, 0);
    const totalRetailValue = items.reduce((acc, i) => acc + i.retailValue, 0);

    return {
      totalSKUs: products.length,
      inStockSKUs: products.length - outOfStock.length,
      lowStockSKUs: lowStock.length,
      outOfStockSKUs: outOfStock.length,
      totalCostValue,
      totalRetailValue,
      totalPotentialProfit: totalRetailValue - totalCostValue,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  public static async getLowStockProducts(businessId: string): Promise<Product[]> {
    const products = await db.getAllProducts(businessId);
    return products.filter(p => p.currentStock <= p.minStockLevel);
  }

  public static async getInventorySummary(businessId: string): Promise<{
    totalProducts: number;
    totalInventoryValue: number;
    lowStockCount: number;
    lowStockProducts: Product[];
  }> {
    const products = await db.getAllProducts(businessId);
    const lowStock = products.filter(p => p.currentStock <= p.minStockLevel);
    const totalValue = products.reduce((acc, p) => acc + (p.currentStock * p.costPrice), 0);

    return {
      totalProducts: products.length,
      totalInventoryValue: totalValue,
      lowStockCount: lowStock.length,
      lowStockProducts: lowStock,
    };
  }

  public static async getTransactions(businessId: string, limit: number = 50): Promise<InventoryTransaction[]> {
    return db.getInventoryTransactions(businessId, limit);
  }
}
