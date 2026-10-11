import crypto from 'crypto';
import { db } from '../server/db/storage.ts';
import { firestoreDb } from '../server/db/firestoreStorage.ts';
import { serverDb } from '../server/firebase.ts';
import { SalesService } from '../server/modules/sales/index.ts';
import { CustomerService } from '../server/modules/customers/index.ts';
import { ProductService } from '../server/modules/products/index.ts';
import { InventoryService } from '../server/modules/inventory/index.ts';
import { 
  verifyMetaSignature, 
  computeMetaSignature 
} from '../whatsapp/security/webhookSignature.ts';
import { MessageIdempotencyService } from '../whatsapp/idempotency/index.ts';
import { ConversationSessionService } from '../whatsapp/conversation/sessionService.ts';
import { ConversationProcessor } from '../whatsapp/conversation/processor.ts';
import { normalizeMetaWebhook } from '../whatsapp/index.ts';
import { validateStartupConfig, config } from '../server/config.ts';
import { ConversationExecutionResult } from '../whatsapp/types/index.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function runHardeningTestSuite() {
  console.log('================================================================');
  console.log('RUNNING PRODUCTION-READINESS HARDENING TEST SUITE');
  console.log('================================================================\n');

  // =========================================================================
  // SUITE 1: META WEBHOOK HMAC VERIFICATION (BLOCKER 1)
  // =========================================================================
  console.log('--- SUITE 1: META WEBHOOK HMAC VERIFICATION ---');

  const testSecret = 'hardening_test_secret_key_12345';
  const testPayload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '123', changes: [] }],
  });
  const rawBodyBuffer = Buffer.from(testPayload, 'utf-8');

  // Test 1.1: Valid signature accepted
  const validSignature = computeMetaSignature(rawBodyBuffer, testSecret);
  const validResult = verifyMetaSignature(rawBodyBuffer, validSignature, testSecret);
  assert(validResult.isValid === true, 'Valid signature is accepted with HTTP 200');
  assert(validResult.statusCode === 200, 'Valid signature returns statusCode 200');

  // Test 1.2: Invalid signature rejected
  const invalidSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';
  const invalidResult = verifyMetaSignature(rawBodyBuffer, invalidSignature, testSecret);
  assert(invalidResult.isValid === false, 'Invalid signature is rejected');
  assert(invalidResult.statusCode === 401, 'Invalid signature returns HTTP 401');

  // Test 1.3: Missing signature rejected
  const missingSigResult = verifyMetaSignature(rawBodyBuffer, undefined, testSecret);
  assert(missingSigResult.isValid === false, 'Missing signature header is rejected');
  assert(missingSigResult.statusCode === 401, 'Missing signature header returns HTTP 401');

  // Test 1.4: Modified body rejected (tamper resistance)
  const modifiedBodyBuffer = Buffer.from(JSON.stringify({ object: 'tampered' }), 'utf-8');
  const tamperedResult = verifyMetaSignature(modifiedBodyBuffer, validSignature, testSecret);
  assert(tamperedResult.isValid === false, 'Tampered request body fails HMAC check');
  assert(tamperedResult.statusCode === 401, 'Tampered request body returns HTTP 401');

  // Test 1.5: Missing META_APP_SECRET handled safely (in production configuration rejects with 401)
  const noSecretResult = verifyMetaSignature(rawBodyBuffer, validSignature, '');
  assert(noSecretResult.isValid === false, 'Missing app secret safely rejects webhook in production');
  assert(noSecretResult.statusCode === 401, 'Missing app secret returns HTTP 401');

  console.log('  SUITE 1 PASSED.\n');

  // =========================================================================
  // SUITE 2: FIRESTORE-BACKED DISTRIBUTED IDEMPOTENCY (BLOCKER 2)
  // =========================================================================
  console.log('--- SUITE 2: FIRESTORE-BACKED DISTRIBUTED IDEMPOTENCY ---');

  const testBiz = `biz_hardening_${Date.now()}`;
  await firestoreDb.seedDemoCatalog(testBiz);

  const testMsgId = `wamid_idemp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Test 2.1: First claim succeeds and records PROCESSING in Firestore
  const claim1 = await MessageIdempotencyService.claimMessage(testMsgId, testBiz, 'whatsapp_meta');
  assert(claim1.status === 'CLAIMED', 'First claim succeeds as CLAIMED');

  const fsRecord = await MessageIdempotencyService.getRecord(testMsgId);
  assert(fsRecord !== null, 'Idempotency record exists in Firestore');
  assert(fsRecord!.status === 'PROCESSING', 'Firestore document status is PROCESSING');
  assert(fsRecord!.businessId === testBiz, 'Firestore document has correct businessId');

  // Test 2.2: Duplicate while PROCESSING returns DUPLICATE_PROCESSING
  const claimDuplicateInFlight = await MessageIdempotencyService.claimMessage(testMsgId, testBiz, 'whatsapp_meta');
  assert(claimDuplicateInFlight.status === 'DUPLICATE_PROCESSING', 'Concurrent claim while PROCESSING is caught');

  // Test 2.3: Completing message stores response in Firestore
  const mockResponse: ConversationExecutionResult = {
    messageId: testMsgId,
    conversationId: `conv_${testMsgId}`,
    channel: 'WHATSAPP',
    success: true,
    text: 'Sale confirmed: 5 cartons Indomie. Total: ₦42,500',
    intent: 'RECORD_SALE',
    dashboardRefreshRequired: true,
    sessionStatus: 'ACTIVE',
  };
  await MessageIdempotencyService.completeMessage(testMsgId, mockResponse);

  const completedFsRecord = await MessageIdempotencyService.getRecord(testMsgId);
  assert(completedFsRecord!.status === 'COMPLETED', 'Firestore document status is COMPLETED');
  assert(completedFsRecord!.response?.text === mockResponse.text, 'Stored response matches original response');

  // Test 2.4: Duplicate webhook returns stored response without reprocessing
  const claimAfterComplete = await MessageIdempotencyService.claimMessage(testMsgId, testBiz, 'whatsapp_meta');
  assert(claimAfterComplete.status === 'DUPLICATE_COMPLETED', 'Duplicate returns DUPLICATE_COMPLETED');
  assert((claimAfterComplete as any).response?.text === mockResponse.text, 'Stored response is returned from claim');

  // Test 2.5: Duplicate after application restart (clear L1 in-memory cache)
  MessageIdempotencyService.clearMemoryCache();
  const claimAfterRestart = await MessageIdempotencyService.claimMessage(testMsgId, testBiz, 'whatsapp_meta');
  assert(claimAfterRestart.status === 'DUPLICATE_COMPLETED', 'Survives application restart (L1 cache cleared) via Firestore');
  assert((claimAfterRestart as any).response?.text === mockResponse.text, 'Returns stored response from Firestore after restart');

  // Test 2.6: Failed processing does not create false success
  const failMsgId = `wamid_fail_${Date.now()}`;
  await MessageIdempotencyService.claimMessage(failMsgId, testBiz, 'whatsapp_meta');
  await MessageIdempotencyService.failMessage(failMsgId, new Error('Simulated gateway timeout'));

  const failedFsRecord = await MessageIdempotencyService.getRecord(failMsgId);
  assert(failedFsRecord!.status === 'FAILED', 'Firestore document status is FAILED');
  assert(failedFsRecord!.error?.message === 'Simulated gateway timeout', 'Error message recorded in Firestore');

  const claimFailedDuplicate = await MessageIdempotencyService.claimMessage(failMsgId, testBiz, 'whatsapp_meta');
  assert(claimFailedDuplicate.status === 'DUPLICATE_FAILED', 'Failed duplicate handled safely as DUPLICATE_FAILED');

  console.log('  SUITE 2 PASSED.\n');

  // =========================================================================
  // SUITE 3: FIRESTORE TRANSACTION ATOMICITY & CONCURRENCY (BLOCKER 3)
  // =========================================================================
  console.log('--- SUITE 3: FIRESTORE TRANSACTION ATOMICITY & CONCURRENCY ---');

  const concurrencyBiz = `biz_concurrency_${Date.now()}`;
  await firestoreDb.seedDemoCatalog(concurrencyBiz);

  // Set up product with limited stock = 5
  const prod = await firestoreDb.createProduct({
    businessId: concurrencyBiz,
    sku: 'CONC-SKU-01',
    name: 'Limited Stock Widget',
    unit: 'carton',
    costPrice: 2000,
    sellingPrice: 3000,
    currentStock: 5,
    minStockLevel: 2,
    active: true,
  });

  // Test 3.1: Two simultaneous sales against limited stock (Stock = 5, both request 4)
  // One must succeed, one must fail with insufficient stock. Final stock must be exactly 1, NEVER -3.
  console.log('  Testing two simultaneous sales against limited stock (5 in stock, two sales of 4 each)...');
  const sale1Promise = SalesService.recordSale(concurrencyBiz, 'Cashier A', {
    items: [{ productId: prod.id, quantity: 4 }],
  });
  const sale2Promise = SalesService.recordSale(concurrencyBiz, 'Cashier B', {
    items: [{ productId: prod.id, quantity: 4 }],
  });

  const results = await Promise.allSettled([sale1Promise, sale2Promise]);
  const succeededSales = results.filter(r => r.status === 'fulfilled');
  const failedSales = results.filter(r => r.status === 'rejected');

  assert(succeededSales.length === 1, `Exactly 1 sale succeeded (actual: ${succeededSales.length})`);
  assert(failedSales.length === 1, `Exactly 1 sale failed (actual: ${failedSales.length})`);

  const productAfterConcurrentSales = await firestoreDb.getProduct(prod.id);
  assert(productAfterConcurrentSales!.currentStock === 1, `Final stock is exactly 1 (actual: ${productAfterConcurrentSales!.currentStock})`);
  assert(productAfterConcurrentSales!.currentStock >= 0, 'Stock never went negative');

  // Test 3.2: Two simultaneous payments against the same customer balance
  console.log('  Testing two simultaneous customer payments...');
  const testCustomer = await firestoreDb.findOrCreateCustomer(concurrencyBiz, 'Concurrent Alhaji Musa', '2348099887766');
  const custId = testCustomer.customerId || testCustomer.id || '';
  // Initialize balance to ₦5,000 via a credit sale
  await SalesService.recordSale(concurrencyBiz, 'Store Owner', {
    items: [{ productId: prod.id, quantity: 1 }],
    customerName: testCustomer.name,
    customerPhone: testCustomer.phone,
    paymentMethod: 'CREDIT',
    amountPaid: 0,
  });

  const customerBeforePayments = await firestoreDb.getCustomer(custId);
  const initialBalance = customerBeforePayments!.balance;
  assert(initialBalance > 0, `Customer initial balance is positive: ${initialBalance}`);

  // Two concurrent payments of ₦1,000 each
  const paymentAmount = 1000;
  const pay1Promise = CustomerService.recordCustomerPayment(concurrencyBiz, 'Cashier A', {
    customerNameOrId: testCustomer.name,
    amount: paymentAmount,
  });
  const pay2Promise = CustomerService.recordCustomerPayment(concurrencyBiz, 'Cashier B', {
    customerNameOrId: testCustomer.name,
    amount: paymentAmount,
  });

  const payResults = await Promise.allSettled([pay1Promise, pay2Promise]);
  const successfulPayments = payResults.filter(r => r.status === 'fulfilled');
  assert(successfulPayments.length === 2, 'Both concurrent payments completed successfully');

  const customerAfterPayments = await firestoreDb.getCustomer(custId);
  const expectedBalance = initialBalance - (paymentAmount * 2);
  assert(
    customerAfterPayments!.balance === expectedBalance,
    `Customer balance serialized correctly: expected ${expectedBalance}, actual ${customerAfterPayments!.balance}`
  );

  // Test 3.3: Sale with immediate full payment creates payment record and sets balanceDue = 0
  const fullPayProd = await firestoreDb.createProduct({
    businessId: concurrencyBiz,
    sku: 'FULL-PAY-01',
    name: 'Full Payment Item',
    unit: 'piece',
    costPrice: 500,
    sellingPrice: 1500,
    currentStock: 10,
    minStockLevel: 2,
    active: true,
  });

  const fullPaymentSale = await SalesService.recordSale(concurrencyBiz, 'Store Cashier', {
    items: [{ productId: fullPayProd.id, quantity: 1 }],
    amountPaid: 1500,
    paymentMethod: 'CASH',
  });
  assert(fullPaymentSale.sale.paymentStatus === 'PAID', 'Full payment sets paymentStatus to PAID');
  assert(fullPaymentSale.sale.balanceDue === 0, 'Full payment sets balanceDue to 0');
  assert(fullPaymentSale.sale.amountPaid === 1500, 'Sale records amountPaid = 1500');

  // Test 3.4: Failed transaction leaves no partial documents
  const preSales = await firestoreDb.getSales(concurrencyBiz);
  try {
    await SalesService.recordSale(concurrencyBiz, 'Store Cashier', {
      items: [{ productId: prod.id, quantity: 999999 }], // Exceeds available stock
    });
    assert(false, 'Should have thrown insufficient stock error');
  } catch (err: any) {
    assert(err.message.includes('Insufficient stock'), 'Oversell attempt threw Insufficient stock');
  }
  const postSales = await firestoreDb.getSales(concurrencyBiz);
  assert(postSales.length === preSales.length, 'Failed transaction created no orphan sale documents');

  console.log('  SUITE 3 PASSED.\n');

  // =========================================================================
  // SUITE 4: CONVERSATION SESSION PERSISTENCE & MULTI-TURN RESTART
  // =========================================================================
  console.log('--- SUITE 4: CONVERSATION SESSION PERSISTENCE & MULTI-TURN RESTART ---');

  const sessionBiz = `biz_session_${Date.now()}`;
  await firestoreDb.seedDemoCatalog(sessionBiz);
  const senderId = '2348011223344';

  // Step 1: Create session with clarification
  const initialSession = await ConversationSessionService.getOrCreateSession('WHATSAPP', sessionBiz, senderId);
  await ConversationSessionService.setPendingClarification(initialSession, 'RECORD_SALE', {
    quantity: 5,
    partialQuery: 'Indomie',
    unitPrice: 8500,
  });

  // Verify Firestore document
  const expectedDocId = ConversationSessionService.getSessionDocId('WHATSAPP', sessionBiz, senderId);
  const sessionFsData = await ConversationSessionService.getSessionDoc(expectedDocId);
  assert(Boolean(sessionFsData), 'Session document persisted to Firestore collection conversationSessions');
  assert(sessionFsData?.status === 'AWAITING_CLARIFICATION', 'Firestore session status is AWAITING_CLARIFICATION');
  assert(sessionFsData?.pendingIntent === 'RECORD_SALE', 'Firestore session pendingIntent is RECORD_SALE');
  assert(sessionFsData?.pendingEntities?.quantity === 5, 'Firestore session pendingEntities has quantity 5');

  // Step 2: Clear memory cache to simulate app restart
  ConversationSessionService.clearMemoryCache();

  // Step 3: Retrieve session after restart - must load from Firestore
  const reloadedSession = await ConversationSessionService.getOrCreateSession('WHATSAPP', sessionBiz, senderId);
  assert(reloadedSession.status === 'AWAITING_CLARIFICATION', 'Session survives restart: status is AWAITING_CLARIFICATION');
  assert(reloadedSession.pendingIntent === 'RECORD_SALE', 'Session survives restart: pendingIntent is RECORD_SALE');
  assert(reloadedSession.pendingEntities?.quantity === 5, 'Session survives restart: pendingEntities retained');

  // Step 4: Multi-tenant isolation - Business B cannot access Business A's session
  const businessBSession = await ConversationSessionService.getOrCreateSession('WHATSAPP', 'biz_other_tenant', senderId);
  assert(businessBSession.status === 'ACTIVE', 'Different business gets an isolated session (status ACTIVE)');
  assert(businessBSession.pendingIntent === undefined || businessBSession.pendingIntent === null, 'Different business has no access to pendingIntent');

  // Clean up session clarification
  await ConversationSessionService.clearPendingClarification(reloadedSession);
  const clearedSession = await ConversationSessionService.getOrCreateSession('WHATSAPP', sessionBiz, senderId);
  assert(clearedSession.status === 'ACTIVE', 'Session cleared clarification back to ACTIVE');

  console.log('  SUITE 4 PASSED.\n');

  // =========================================================================
  // SUITE 5: ENVIRONMENT CONFIGURATION & STARTUP VALIDATION (BLOCKER 4)
  // =========================================================================
  console.log('--- SUITE 5: ENVIRONMENT CONFIGURATION & STARTUP VALIDATION ---');

  // Test 5.1: Validate startup config runs without error and identifies missing optional vars
  const validationResult = validateStartupConfig();
  assert(validationResult.valid === true, 'validateStartupConfig returns valid=true');
  assert(Array.isArray(validationResult.missing), 'validationResult reports missing optional config list');
  assert(validationResult.missing.includes('META_APP_SECRET'), 'Missing META_APP_SECRET reported clearly by name');

  // Test 5.2: Ensure secrets are never exposed in validation output
  const serialized = JSON.stringify(validationResult);
  assert(!serialized.includes('secret_'), 'Validation output contains variable names only, never secret values');
  assert(typeof config.whatsappVerifyToken === 'string', 'whatsappVerifyToken is loaded as string');
  assert(config.metaAppSecret === null || typeof config.metaAppSecret === 'string', 'metaAppSecret safely nullable in dev');

  console.log('  SUITE 5 PASSED.\n');

  console.log('================================================================');
  console.log('ALL PRODUCTION-READINESS HARDENING TESTS PASSED SUCCESSFULLY! ✅');
  console.log('================================================================');
  process.exit(0);
}

runHardeningTestSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
