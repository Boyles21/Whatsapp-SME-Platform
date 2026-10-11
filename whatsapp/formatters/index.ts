/**
 * WhatsApp-friendly response formatter.
 * Produces clean, concise, human-readable text for WhatsApp users.
 * Strictly avoids exposing internal IDs, database keys, or technical audit logs.
 */

export class WhatsAppResponseFormatter {
  /**
   * Formats a single product stock query.
   *
   * Example:
   * 📦 Indomie Super Pack
   * Stock: 90 cartons
   * Selling price: ₦8,500
   * Status: In stock
   */
  public static formatStockQuery(product: {
    name: string;
    currentStock: number;
    unit: string;
    sellingPrice: number;
    minStockLevel?: number;
    currencySymbol?: string;
  }): string {
    const curr = product.currencySymbol || '₦';
    const isLow = product.minStockLevel !== undefined && product.currentStock <= product.minStockLevel;
    const isOut = product.currentStock <= 0;
    const status = isOut ? 'Out of stock' : isLow ? 'Low stock' : 'In stock';

    return [
      `📦 ${product.name}`,
      `Stock: ${product.currentStock} ${product.unit}${product.currentStock === 1 ? '' : 's'}`,
      `Selling price: ${curr}${product.sellingPrice.toLocaleString()}`,
      `Status: ${status}`,
    ].join('\n');
  }

  /**
   * Formats multiple products overview.
   */
  public static formatCatalogOverview(products: Array<{
    name: string;
    currentStock: number;
    unit: string;
    minStockLevel?: number;
  }>): string {
    if (!products.length) {
      return `📦 Inventory catalog is currently empty.`;
    }

    const lines = [`📦 Current Stock Levels:`];
    for (const p of products) {
      const isLow = p.minStockLevel !== undefined && p.currentStock <= p.minStockLevel;
      const tag = p.currentStock <= 0 ? ' (Out of stock)' : isLow ? ' (Low stock)' : '';
      lines.push(`• ${p.name}: ${p.currentStock} ${p.unit}s${tag}`);
    }
    return lines.join('\n');
  }

  /**
   * Formats a stock addition confirmation.
   *
   * Example:
   * ✅ Stock added
   * Indomie Super Pack
   * Added: +50 cartons
   * New stock: 95 cartons
   */
  public static formatStockAdded(params: {
    productName: string;
    quantity: number;
    unit: string;
    newStock: number;
    unitCost?: number;
    currencySymbol?: string;
  }): string {
    const curr = params.currencySymbol || '₦';
    const lines = [
      `✅ Stock added`,
      params.productName,
      `Added: +${params.quantity} ${params.unit}${params.quantity === 1 ? '' : 's'}`,
    ];

    if (params.unitCost && params.unitCost > 0) {
      lines.push(`Cost: ${curr}${params.unitCost.toLocaleString()} each`);
    }

    lines.push(`New stock: ${params.newStock} ${params.unit}${params.newStock === 1 ? '' : 's'}`);
    return lines.join('\n');
  }

  /**
   * Formats a completed sale or credit sale.
   *
   * Standard Cash Sale Example:
   * ✅ Sale recorded
   * Invoice: INV-000123
   * 5 × Indomie Super Pack
   * Total: ₦42,500
   * Paid: ₦42,500
   * Balance: ₦0
   * Remaining stock: 85 cartons
   *
   * Credit Sale Example:
   * ✅ Sale recorded
   * Total: ₦42,500
   * Paid: ₦20,000
   * Credit: ₦22,500
   * Customer: Emeka
   */
  public static formatSale(params: {
    invoiceNumber?: string;
    productName?: string;
    quantity?: number;
    unit?: string;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
    remainingStock?: number;
    customerName?: string;
    currencySymbol?: string;
  }): string {
    const curr = params.currencySymbol || '₦';
    const isCreditSale = params.balanceDue > 0;

    if (isCreditSale) {
      const lines = [
        `✅ Sale recorded`,
      ];
      if (params.invoiceNumber) {
        lines.push(`Invoice: ${params.invoiceNumber}`);
      }
      lines.push(`Total: ${curr}${params.totalAmount.toLocaleString()}`);
      lines.push(`Paid: ${curr}${params.amountPaid.toLocaleString()}`);
      lines.push(`Credit: ${curr}${params.balanceDue.toLocaleString()}`);
      if (params.customerName) {
        lines.push(`Customer: ${params.customerName}`);
      }
      if (params.remainingStock !== undefined && params.unit) {
        lines.push(`Remaining stock: ${params.remainingStock} ${params.unit}${params.remainingStock === 1 ? '' : 's'}`);
      }
      return lines.join('\n');
    }

    // Standard cash sale
    const lines = [
      `✅ Sale recorded`,
    ];
    if (params.invoiceNumber) {
      lines.push(`Invoice: ${params.invoiceNumber}`);
    }
    if (params.quantity && params.productName) {
      lines.push(`${params.quantity} × ${params.productName}`);
    }
    lines.push(`Total: ${curr}${params.totalAmount.toLocaleString()}`);
    lines.push(`Paid: ${curr}${params.amountPaid.toLocaleString()}`);
    lines.push(`Balance: ${curr}0`);
    if (params.remainingStock !== undefined && params.unit) {
      lines.push(`Remaining stock: ${params.remainingStock} ${params.unit}${params.remainingStock === 1 ? '' : 's'}`);
    }
    return lines.join('\n');
  }

  /**
   * Formats customer payment receipt.
   *
   * Example:
   * ✅ Payment recorded
   * Customer: Emeka
   * Paid: ₦10,000
   * Remaining balance: ₦12,500
   */
  public static formatPayment(params: {
    customerName: string;
    amountPaid: number;
    remainingBalance: number;
    currencySymbol?: string;
  }): string {
    const curr = params.currencySymbol || '₦';
    return [
      `✅ Payment recorded`,
      `Customer: ${params.customerName}`,
      `Paid: ${curr}${params.amountPaid.toLocaleString()}`,
      `Remaining balance: ${curr}${params.remainingBalance.toLocaleString()}`,
    ].join('\n');
  }

  /**
   * Formats customer balance inquiry.
   */
  public static formatCustomerBalance(params: {
    customerName: string;
    balance: number;
    currencySymbol?: string;
  }): string {
    const curr = params.currencySymbol || '₦';
    if (params.balance > 0) {
      return [
        `👤 Customer Account`,
        `Customer: ${params.customerName}`,
        `Outstanding credit: ${curr}${params.balance.toLocaleString()}`,
        `Status: Unpaid debt`,
      ].join('\n');
    }
    return [
      `👤 Customer Account`,
      `Customer: ${params.customerName}`,
      `Balance: ${curr}0`,
      `Status: Account cleared`,
    ].join('\n');
  }

  /**
   * Formats low stock alert.
   */
  public static formatLowStock(products: Array<{
    name: string;
    currentStock: number;
    unit: string;
    minStockLevel: number;
  }>): string {
    if (!products.length) {
      return `✅ All inventory items are currently above their minimum threshold.`;
    }

    const lines = [`⚠️ Low Stock Alert (${products.length} items)`];
    for (const p of products) {
      lines.push(`• ${p.name}: ${p.currentStock} ${p.unit}s left (min: ${p.minStockLevel})`);
    }
    lines.push(`\nReply with "Add [qty] cartons of [product]" to replenish.`);
    return lines.join('\n');
  }

  /**
   * Formats daily sales summary.
   */
  public static formatTodaySales(summary: {
    totalRevenue: number;
    totalCount: number;
    currencySymbol?: string;
    itemsSummary?: Array<{ name: string; quantity: number; unit: string; total: number }>;
  }): string {
    const curr = summary.currencySymbol || '₦';
    const lines = [
      `📊 Today's Sales`,
      `Revenue: ${curr}${summary.totalRevenue.toLocaleString()}`,
      `Transactions: ${summary.totalCount}`,
    ];

    if (summary.itemsSummary && summary.itemsSummary.length > 0) {
      lines.push(`\nItems sold:`);
      for (const item of summary.itemsSummary) {
        lines.push(`• ${item.name}: ${item.quantity} ${item.unit}s (${curr}${item.total.toLocaleString()})`);
      }
    } else {
      lines.push(`\nNo sales recorded yet today.`);
    }

    return lines.join('\n');
  }

  /**
   * Formats an error or transaction rejection.
   * Ensures internal stack traces or database errors are stripped.
   */
  public static formatError(message: string, context?: {
    productName?: string;
    availableStock?: number;
    requestedQuantity?: number;
    unit?: string;
  }): string {
    if (context && context.availableStock !== undefined && context.requestedQuantity !== undefined) {
      return [
        `❌ Insufficient stock`,
        `You have ${context.availableStock} ${context.unit || 'unit'}${context.availableStock === 1 ? '' : 's'} of "${context.productName || 'this product'}" in stock, but tried to sell ${context.requestedQuantity}.`,
        `Stock cannot become negative.`,
      ].join('\n');
    }

    // Strip internal code/stack terms
    const sanitized = message
      .replace(/\[.*?\]/g, '')
      .replace(/tx_[a-zA-Z0-9_]+/g, '')
      .replace(/biz_[a-zA-Z0-9_]+/g, '')
      .replace(/prod_[a-zA-Z0-9_]+/g, '')
      .trim();

    return `❌ ${sanitized || 'Transaction could not be processed. Please check your request.'}`;
  }

  /**
   * Formats clarification prompt with candidate options if any.
   */
  public static formatClarification(
    prompt: string,
    candidates?: Array<{ name: string; currentStock?: number; unit?: string }>
  ): string {
    if (candidates && candidates.length > 0) {
      const options = candidates
        .map(c => `• ${c.name}${c.currentStock !== undefined ? ` (${c.currentStock} in stock)` : ''}`)
        .join('\n');
      return `${prompt}\n\n${options}\n\nPlease reply with the product name.`;
    }
    return prompt;
  }
}
