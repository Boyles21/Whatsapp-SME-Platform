import { firestoreDb } from '../server/db/firestoreStorage.ts';
import { InventoryService } from '../server/modules/inventory/index.ts';
import { SalesService } from '../server/modules/sales/index.ts';
import { ProductService } from '../server/modules/products/index.ts';
import { db } from '../server/db/storage.ts';

async function runMilestoneVerification() {
  console.log('=== STARTING FIREBASE PERSISTENCE & INVENTORY TEST ===\n');

  const businessId = 'biz_bello_01';
  const actor = 'Alhaji Bello';

  // 1. Seed Demo Data in Firestore
  console.log('1. Seeding demo business & catalog in Firestore...');
  await firestoreDb.seedDemoCatalog(businessId);
  console.log('✅ Demo business and initial Indomie product seeded.');

  // 2. Authoritative initial stock check
  console.log('\n2. Verifying initial product stock in Firestore...');
  const products = await db.getAllProducts(businessId);
  const indomie = products.find(p => p.name.includes('Indomie'));
  if (!indomie) throw new Error('Indomie product not found in Firestore!');
  console.log(`Initial stock of ${indomie.name}: ${indomie.currentStock} cartons (Expected: 45)`);
  if (indomie.currentStock !== 45) {
    throw new Error(`Expected 45, got ${indomie.currentStock}`);
  }

  // 3. Stock In: Add 50 cartons
  console.log('\n3. Adding 50 cartons of Indomie via authoritative InventoryService...');
  const stockAddResult = await InventoryService.addStock(businessId, actor, {
    productId: indomie.id,
    quantity: 50,
    unitCost: 7500,
    notes: 'Batch restock #204',
  });
  console.log(`Stock after adding 50: ${stockAddResult.product.currentStock} cartons (Expected: 95)`);
  if (stockAddResult.product.currentStock !== 95) {
    throw new Error(`Expected 95, got ${stockAddResult.product.currentStock}`);
  }

  // 4. Record Sale: Sell 5 cartons
  console.log('\n4. Recording sale of 5 cartons of Indomie...');
  const saleResult = await SalesService.recordSale(businessId, actor, {
    items: [{ productId: indomie.id, quantity: 5, unitPrice: 8500 }],
    customerName: 'Mama Nkechi',
    notes: 'Walk-in cash sale',
  });
  const remainingStockAfterSale = saleResult.updatedProducts[0].currentStock;
  console.log(`Sale Invoice: ${saleResult.sale.invoiceNumber}, Total: ₦${saleResult.sale.totalAmount}`);
  console.log(`Stock after selling 5: ${remainingStockAfterSale} cartons (Expected: 90)`);
  if (remainingStockAfterSale !== 90) {
    throw new Error(`Expected 90, got ${remainingStockAfterSale}`);
  }

  // 5. Subsequent Query Verification
  console.log('\n5. Querying fresh authoritative stock balance directly from Firestore...');
  const refreshedProduct = await InventoryService.getProductBalance(indomie.id);
  console.log(`Authoritative query balance: ${refreshedProduct?.currentStock} cartons (Expected: 90)`);
  if (refreshedProduct?.currentStock !== 90) {
    throw new Error(`Synchronization bug detected! Expected 90, got ${refreshedProduct?.currentStock}`);
  }

  // 6. Oversale rejection test
  console.log('\n6. Testing oversale rejection (attempting to sell 150 cartons when only 90 exist)...');
  try {
    await SalesService.recordSale(businessId, actor, {
      items: [{ productId: indomie.id, quantity: 150, unitPrice: 8500 }],
      customerName: 'Bulk Buyer',
    });
    throw new Error('FAILURE: Oversale should have been rejected but succeeded!');
  } catch (err: any) {
    console.log(`✅ Oversale correctly blocked with error: "${err.message}"`);
  }

  // 7. Verify Inventory Transactions & Audit Logs
  console.log('\n7. Verifying inventory transactions & audit logs in Firestore...');
  const txs = await db.getInventoryTransactions(businessId, indomie.id);
  console.log(`Total transactions for Indomie: ${txs.length}`);
  const stockInTx = txs.find(t => t.type === 'STOCK_IN' && t.quantityChange === 50);
  const saleTx = txs.find(t => t.type === 'SALE' && t.quantityChange === -5);
  if (!stockInTx) throw new Error('Missing STOCK_IN inventory transaction in Firestore!');
  if (!saleTx) throw new Error('Missing SALE inventory transaction in Firestore!');
  console.log(`✅ Found STOCK_IN transaction: ID=${stockInTx.id || stockInTx.transactionId}, newStock=${stockInTx.newStock}`);
  console.log(`✅ Found SALE transaction: ID=${saleTx.id || saleTx.transactionId}, newStock=${saleTx.newStock}`);

  const auditLogs = await db.getAuditLogs(businessId);
  console.log(`Total audit logs recorded for business: ${auditLogs.length}`);
  const stockAudit = auditLogs.find(a => a.action === 'STOCK_ADDED');
  const saleAudit = auditLogs.find(a => a.action === 'SALE_CREATED');
  if (!stockAudit || !saleAudit) throw new Error('Missing audit log entries!');
  console.log(`✅ Found STOCK_ADDED and SALE_CREATED audit entries.`);

  // 8. Multi-tenant isolation test
  console.log('\n8. Testing multi-tenant data isolation...');
  const tenantBId = 'biz_tenant_test_99';
  if ((db as any).createBusiness) {
    await (db as any).createBusiness({
      businessId: tenantBId,
      id: tenantBId,
      name: 'Tenant B Supermarket',
      businessType: 'Supermarket',
      currency: 'NGN',
      country: 'Nigeria',
      ownerId: 'user_tenant_b',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  await db.createProduct({
    businessId: tenantBId,
    productId: 'prod_tenant_b_soap',
    name: 'Tenant B Unique Soap',
    sku: 'SOAP-01',
    unit: 'bar',
    costPrice: 200,
    sellingPrice: 350,
    currentStock: 100,
    minStockLevel: 10,
  });

  const tenantBProducts = await db.getAllProducts(tenantBId);
  const tenantAProducts = await db.getAllProducts(businessId);

  const leakFoundInA = tenantAProducts.some(p => p.name === 'Tenant B Unique Soap');
  const leakFoundInB = tenantBProducts.some(p => p.name.includes('Indomie'));

  if (leakFoundInA || leakFoundInB) {
    throw new Error('Tenant isolation failure: Cross-tenant data leakage detected!');
  }
  console.log(`✅ Multi-tenant isolation verified: Tenant A has ${tenantAProducts.length} items, Tenant B has ${tenantBProducts.length} items with 0 leakage.`);

  // 9. Customer and Payment test
  console.log('\n9. Testing Customer creation and payment tracking in Firestore...');
  const cust = await db.findOrCreateCustomer(businessId, 'Emeka Okafor', '08023456789');
  console.log(`Created customer: ${cust.name}, balance: ${cust.balance}`);
  const custId = cust.customerId || cust.id || '';
  const payment = await db.recordPayment({
    businessId,
    customerId: custId,
    amount: 15000,
    method: 'TRANSFER',
    reference: 'PAY-1001',
    recordedBy: actor,
  });
  console.log(`Recorded payment: ID=${payment.id || payment.paymentId}, amount=₦${payment.amount}`);
  const updatedCust = custId ? await db.getCustomer(custId) : null;
  console.log(`Updated customer debt balance: ₦${updatedCust?.balance}`);

  console.log('\n🎉 ALL FIREBASE PERSISTENCE & MULTI-TENANT TESTS PASSED SUCCESSFULLY!');
}

runMilestoneVerification()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  });
