import { db, IDatabaseStorage } from '../../db/storage.ts';
import { Product } from '../../types.ts';
import { AuditService } from '../audit/index.ts';

export interface ProductResolutionResult {
  status: 'EXACT_MATCH' | 'AMBIGUOUS' | 'NOT_FOUND';
  product?: Product;
  candidates?: Product[];
  searchTerm: string;
}

export class ProductService {
  public static async listProducts(businessId: string): Promise<Product[]> {
    return db.getAllProducts(businessId);
  }

  public static async getProductById(productId: string): Promise<Product | null> {
    return db.getProduct(productId);
  }

  /**
   * Resolves natural language product query to an exact internal product ID.
   * Handles ambiguity detection: If multiple products match, flags as AMBIGUOUS
   * rather than blindly guessing.
   */
  public static async resolveProduct(
    businessId: string, 
    query: string
  ): Promise<ProductResolutionResult> {
    const products = await db.getAllProducts(businessId);
    const cleaned = query.trim().toLowerCase();

    // 1. Direct ID match
    const byId = products.find(p => p.id.toLowerCase() === cleaned);
    if (byId) {
      return { status: 'EXACT_MATCH', product: byId, searchTerm: query };
    }

    // 2. Direct SKU match
    const bySku = products.find(p => p.sku.toLowerCase() === cleaned);
    if (bySku) {
      return { status: 'EXACT_MATCH', product: bySku, searchTerm: query };
    }

    // 3. Exact Name match
    const byExactName = products.find(p => p.name.toLowerCase() === cleaned);
    if (byExactName) {
      return { status: 'EXACT_MATCH', product: byExactName, searchTerm: query };
    }

    // 4. Token-based / Substring matching
    // Filter out common filler words ("carton", "cartons", "pack", "packs", "bag", "bags", "of", "the", "a")
    const fillerWords = new Set(['carton', 'cartons', 'pack', 'packs', 'bag', 'bags', 'piece', 'pieces', 'tin', 'tins', 'of', 'the', 'a', 'each']);
    const searchTokens = cleaned
      .split(/[\s,.-]+/)
      .filter(t => t.length > 1 && !fillerWords.has(t));

    const matchedProducts: Product[] = [];

    for (const product of products) {
      const prodNameLower = product.name.toLowerCase();
      const prodSkuLower = product.sku.toLowerCase();

      // Check if cleaned query is contained in name
      if (prodNameLower.includes(cleaned)) {
        matchedProducts.push(product);
        continue;
      }

      // Check if all significant search tokens match
      if (searchTokens.length > 0) {
        const allTokensMatch = searchTokens.every(tok => 
          prodNameLower.includes(tok) || prodSkuLower.includes(tok)
        );
        if (allTokensMatch) {
          matchedProducts.push(product);
          continue;
        }

        // Check if primary token matches (e.g. "indomie", "dangote", "milo")
        const primaryMatch = searchTokens.some(tok => 
          tok.length >= 4 && (prodNameLower.includes(tok) || prodSkuLower.includes(tok))
        );
        if (primaryMatch && !matchedProducts.includes(product)) {
          matchedProducts.push(product);
        }
      }
    }

    if (matchedProducts.length === 1) {
      return { status: 'EXACT_MATCH', product: matchedProducts[0], searchTerm: query };
    }

    if (matchedProducts.length > 1) {
      // If there are duplicate candidates with the exact same name, prefer single exact match
      const exactNameMatches = matchedProducts.filter(p => p.name.toLowerCase() === cleaned);
      if (exactNameMatches.length === 1) {
        return { status: 'EXACT_MATCH', product: exactNameMatches[0], searchTerm: query };
      }
      if (exactNameMatches.length > 1) {
        return { status: 'EXACT_MATCH', product: exactNameMatches[0], searchTerm: query };
      }
      // If all matched candidates share the exact same product name, pick the primary one
      const firstName = matchedProducts[0].name.toLowerCase();
      if (matchedProducts.every(p => p.name.toLowerCase() === firstName)) {
        return { status: 'EXACT_MATCH', product: matchedProducts[0], searchTerm: query };
      }

      return { status: 'AMBIGUOUS', candidates: matchedProducts, searchTerm: query };
    }

    return { status: 'NOT_FOUND', searchTerm: query };
  }

  /**
   * Creates a product atomically, creates initial inventory transaction, and records an audit log.
   */
  public static async createProduct(
    businessId: string,
    actor: string,
    data: {
      name: string;
      sku?: string;
      unit?: string;
      costPrice: number;
      sellingPrice: number;
      minStockLevel?: number;
      initialStock?: number;
    }
  ): Promise<Product> {
    return db.runInTransaction(async (txStorage: IDatabaseStorage) => {
      const name = data.name.trim();
      if (!name) {
        throw new Error('Product name is required.');
      }
      if (data.costPrice < 0 || data.sellingPrice < 0) {
        throw new Error('Prices cannot be negative numbers.');
      }

      const generatedSku = data.sku || 
        name.split(' ').map(w => w[0]?.toUpperCase() || '').join('').slice(0, 4) + '-' + Math.floor(100 + Math.random() * 900);
      
      const initialStock = Math.max(0, data.initialStock || 0);

      const product = await txStorage.createProduct({
        businessId,
        name,
        sku: generatedSku,
        unit: data.unit || 'unit',
        currentStock: initialStock,
        costPrice: data.costPrice,
        sellingPrice: data.sellingPrice,
        minStockLevel: data.minStockLevel !== undefined ? data.minStockLevel : 5,
      });

      if (initialStock > 0) {
        await txStorage.createInventoryTransaction({
          businessId,
          productId: product.id,
          productName: product.name,
          type: 'STOCK_IN',
          quantity: initialStock,
          previousStock: 0,
          newStock: initialStock,
          quantityChange: initialStock,
          resultingStock: initialStock,
          unitCost: product.costPrice,
          referenceType: 'MANUAL_IN',
          referenceId: 'PRODUCT_CREATION',
          createdBy: actor,
          notes: `Initial stock upon product creation`,
        });
      }

      await AuditService.recordLog(txStorage, {
        businessId,
        actor,
        action: 'PRODUCT_CREATED',
        entityType: 'PRODUCT',
        entityId: product.id,
        beforeState: null,
        afterState: product,
        metadata: { initialStock },
      });

      return product;
    });
  }

  /**
   * Updates product details atomically with audit logging.
   */
  public static async updateProduct(
    businessId: string,
    actor: string,
    productId: string,
    updates: Partial<Pick<Product, 'name' | 'costPrice' | 'sellingPrice' | 'unit' | 'minStockLevel' | 'active'>>
  ): Promise<Product> {
    return db.runInTransaction(async (txStorage: IDatabaseStorage) => {
      const existing = await txStorage.getProduct(productId);
      if (!existing || existing.businessId !== businessId) {
        throw new Error(`Product "${productId}" not found.`);
      }

      if (updates.costPrice !== undefined && updates.costPrice < 0) {
        throw new Error('Cost price cannot be negative.');
      }
      if (updates.sellingPrice !== undefined && updates.sellingPrice < 0) {
        throw new Error('Selling price cannot be negative.');
      }

      const updated = await txStorage.updateProduct(productId, updates);

      await AuditService.recordLog(txStorage, {
        businessId,
        actor,
        action: 'PRODUCT_UPDATED',
        entityType: 'PRODUCT',
        entityId: productId,
        beforeState: existing,
        afterState: updated,
        metadata: { updates },
      });

      return updated;
    });
  }

  /**
   * Searches products by name, SKU, or unit.
   */
  public static async searchProducts(businessId: string, queryText: string): Promise<Product[]> {
    const products = await db.getAllProducts(businessId);
    const q = queryText.toLowerCase().trim();
    if (!q) return products;
    return products.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.sku.toLowerCase().includes(q) ||
      (p.unit && p.unit.toLowerCase().includes(q))
    );
  }
}
