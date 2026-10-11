import { db } from '../server/db/storage.ts';
import { firestoreDb } from '../server/db/firestoreStorage.ts';
import { InventoryService } from '../server/modules/inventory/index.ts';
import { SalesService } from '../server/modules/sales/index.ts';
import { WhatsAppWorkflowOrchestrator } from '../server/modules/workflow.ts';
import { ProductService } from '../server/modules/products/index.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function runInventoryConsistencyTestSuite() {
  console.log('================================================================');
  console.log('RUNNING SME INVENTORY CONSISTENCY & TRANSACTION AUDIT TEST SUITE');
  console.log('================================================================\n');

  const businessId = 'biz_default';
  const productId = 'prod_indomie_sup';

  // Seed demo catalog in persistent Firestore
  await firestoreDb.seedDemoCatalog(businessId);

  // -------------------------------------------------------------------------
  // TEST 1: Starting stock = 45, Add 50, Expected stock = 95
  // -------------------------------------------------------------------------
  console.log('TEST 1: Starting stock = 45, Add 50, Expected stock = 95');
  const initialIndomie = await db.getProduct(productId);
  assert(initialIndomie !== null, 'Product Indomie exists in catalog');
  assert(initialIndomie!.currentStock === 45, `Starting stock must be 45 (actual: ${initialIndomie!.currentStock})`);

  const addResp = await WhatsAppWorkflowOrchestrator.processIncomingMessage(
    'Add 50 cartons of Indomie at 7500 each',
    businessId
  );
  assert(addResp.dashboardRefreshRequired === true, 'Add stock triggers dashboard refresh');
  
  const indomieAfterAdd = await InventoryService.getProductBalance(productId);
  assert(indomieAfterAdd!.currentStock === 95, `Expected stock = 95 after adding 50 (actual: ${indomieAfterAdd!.currentStock})`);
  assert(addResp.message.text.includes('95'), `Confirmation message reports 95 remaining (actual: "${addResp.message.text}")`);
  console.log('  TEST 1 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 2: Starting stock = 95, Sell 5, Expected stock = 90
  // -------------------------------------------------------------------------
  console.log('TEST 2: Starting stock = 95, Sell 5, Expected stock = 90');
  const sellResp = await WhatsAppWorkflowOrchestrator.processIncomingMessage(
    'I sold 5 cartons of Indomie for 42500',
    businessId
  );
  assert(sellResp.dashboardRefreshRequired === true, 'Sale triggers dashboard refresh');

  const indomieAfterSell = await InventoryService.getProductBalance(productId);
  assert(indomieAfterSell!.currentStock === 90, `Expected stock = 90 after selling 5 (actual: ${indomieAfterSell!.currentStock})`);
  assert(sellResp.message.text.includes('90'), `Sale confirmation reports 90 remaining (actual: "${sellResp.message.text}")`);
  console.log('  TEST 2 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 3: Query stock immediately after TEST 2, Expected stock = 90
  // -------------------------------------------------------------------------
  console.log('TEST 3: Query stock immediately after TEST 2, Expected stock = 90');
  const queryResp1 = await WhatsAppWorkflowOrchestrator.processIncomingMessage(
    'How much Indomie do I have?',
    businessId
  );
  const indomieAuthoritativeAfterQuery1 = await InventoryService.getProductBalance(productId);
  assert(indomieAuthoritativeAfterQuery1!.currentStock === 90, `Authoritative balance is 90 (actual: ${indomieAuthoritativeAfterQuery1!.currentStock})`);
  assert(queryResp1.message.text.includes('90'), `Query stock message reports 90 (actual: "${queryResp1.message.text}")`);
  assert(!queryResp1.message.text.includes('95'), `Query stock message does NOT report stale 95!`);
  console.log('  TEST 3 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 4: Sell 100 when stock = 90, Expected: transaction rejected & stock remains 90
  // -------------------------------------------------------------------------
  console.log('TEST 4: Sell 100 when stock = 90, Expected: transaction rejected and stock remains 90');
  const rejectResp = await WhatsAppWorkflowOrchestrator.processIncomingMessage(
    'I sold 100 cartons of Indomie for 850000',
    businessId
  );
  assert(rejectResp.dashboardRefreshRequired === false, 'Rejected transaction does NOT trigger dashboard refresh');
  assert(
    rejectResp.message.text.includes('Insufficient Stock') || rejectResp.message.text.includes('cannot become negative') || rejectResp.message.text.includes('Rejected'),
    `Sale rejection message informs user about insufficient stock`
  );

  const indomieAfterRejection = await InventoryService.getProductBalance(productId);
  assert(
    indomieAfterRejection!.currentStock === 90,
    `Stock must strictly remain 90 after rejected oversale (actual: ${indomieAfterRejection!.currentStock})`
  );
  console.log('  TEST 4 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 5: Add 20 when stock = 90, Expected stock = 110
  // -------------------------------------------------------------------------
  console.log('TEST 5: Add 20 when stock = 90, Expected stock = 110');
  const add20Resp = await WhatsAppWorkflowOrchestrator.processIncomingMessage(
    'Add 20 cartons of Indomie at 7500 each',
    businessId
  );
  assert(add20Resp.dashboardRefreshRequired === true, 'Add 20 triggers dashboard refresh');

  const indomieAfterAdd20 = await InventoryService.getProductBalance(productId);
  assert(indomieAfterAdd20!.currentStock === 110, `Expected stock = 110 after adding 20 (actual: ${indomieAfterAdd20!.currentStock})`);
  assert(add20Resp.message.text.includes('110'), `Confirmation message reports 110 (actual: "${add20Resp.message.text}")`);
  console.log('  TEST 5 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 6: Query stock immediately after TEST 5, Expected stock = 110
  // -------------------------------------------------------------------------
  console.log('TEST 6: Query stock immediately after TEST 5, Expected stock = 110');
  const queryResp2 = await WhatsAppWorkflowOrchestrator.processIncomingMessage(
    'How much Indomie do I have?',
    businessId
  );
  const indomieAuthoritativeAfterQuery2 = await InventoryService.getProductBalance(productId);
  assert(indomieAuthoritativeAfterQuery2!.currentStock === 110, `Authoritative balance is 110 (actual: ${indomieAuthoritativeAfterQuery2!.currentStock})`);
  assert(queryResp2.message.text.includes('110'), `Query message reports 110 (actual: "${queryResp2.message.text}")`);
  console.log('  TEST 6 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 7: Refresh the browser after every transaction.
  //         The displayed stock must remain correct.
  // -------------------------------------------------------------------------
  console.log('TEST 7: Refresh the browser simulation (fresh fetch from backend)');
  // Simulates browser reload: freshly querying listProducts and getInventorySummary
  const reloadedProducts = await ProductService.listProducts(businessId);
  const reloadedIndomie = reloadedProducts.find(p => p.id === productId);
  assert(reloadedIndomie !== undefined, 'Product found on refresh');
  assert(reloadedIndomie!.currentStock === 110, `Stock on refresh remains exactly 110 (actual: ${reloadedIndomie!.currentStock})`);
  console.log('  TEST 7 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 8: Open the dashboard after a transaction.
  //         The dashboard inventory value and stock quantity must match the transaction history.
  // -------------------------------------------------------------------------
  console.log('TEST 8: Dashboard inventory value and stock quantity must match transaction history');
  const dashboardSummary = await InventoryService.getInventorySummary(businessId);
  const allTransactions = await InventoryService.getTransactions(businessId, 100);
  const indomieTransactions = allTransactions.filter(t => t.productId === productId);

  // Sum quantity changes across all transactions for Indomie:
  // Initial (45) + Added (50) - Sold (5) + Added (20) = 110
  const computedStockFromTx = indomieTransactions.reduce((sum, t) => sum + (t.quantityChange || 0), 0);
  assert(
    computedStockFromTx === 110,
    `Sum of transaction history for Indomie must equal 110 (actual: ${computedStockFromTx})`
  );

  assert(
    reloadedIndomie!.currentStock === computedStockFromTx,
    `Product currentStock (${reloadedIndomie!.currentStock}) strictly matches transaction sum (${computedStockFromTx})`
  );

  // Verify total inventory value in dashboard equals sum of (currentStock * costPrice) across all products
  const expectedTotalValue = reloadedProducts.reduce((acc, p) => acc + (p.currentStock * p.costPrice), 0);
  assert(
    dashboardSummary.totalInventoryValue === expectedTotalValue,
    `Dashboard inventory value (${dashboardSummary.totalInventoryValue}) strictly matches sum of product values (${expectedTotalValue})`
  );

  console.log(`  Dashboard total products: ${dashboardSummary.totalProducts}`);
  console.log(`  Dashboard inventory value: ₦${dashboardSummary.totalInventoryValue.toLocaleString()}`);
  console.log(`  Indomie transactions recorded: ${indomieTransactions.length}`);
  console.log('  TEST 8 PASSED.\n');

  console.log('================================================================');
  console.log('ALL 8 INVENTORY CONSISTENCY & ATOMICITY TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');
}

runInventoryConsistencyTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
