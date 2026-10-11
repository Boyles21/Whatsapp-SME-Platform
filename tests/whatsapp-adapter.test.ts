import { db } from '../server/db/storage.ts';
import { firestoreDb } from '../server/db/firestoreStorage.ts';
import { 
  ConversationProcessor, 
  normalizeWebChatMessage, 
  normalizeMetaWebhook,
  normalizeGenericMessage,
  WhatsAppResponseFormatter,
  MessageIdempotencyService,
  ConversationSessionService,
  WhatsAppProviderRegistry,
  MockWhatsAppProvider
} from '../whatsapp/index.ts';
import { InventoryService } from '../server/modules/inventory/index.ts';
import { ProductService } from '../server/modules/products/index.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function runWhatsAppAdapterTestSuite() {
  console.log('================================================================');
  console.log('RUNNING WHATSAPP MESSAGING ADAPTER & INTEGRATION TEST SUITE');
  console.log('================================================================\n');

  const mockProvider = WhatsAppProviderRegistry.getProvider('mock_whatsapp') as MockWhatsAppProvider;
  mockProvider.clearSentMessages();
  MessageIdempotencyService.clearAll();
  ConversationSessionService.resetAll();

  // -------------------------------------------------------------------------
  // TEST 1: Web chat can create a sale
  // -------------------------------------------------------------------------
  console.log('TEST 1: Web chat can create a sale');
  const biz1 = 'biz_test_web';
  await firestoreDb.seedDemoCatalog(biz1);

  const biz1Products = await ProductService.listProducts(biz1);
  const indomie1 = biz1Products.find(p => p.sku === 'IND-SUP-01');
  assert(indomie1 !== undefined, 'Product Indomie exists in catalog');
  const startingStock1 = indomie1!.currentStock; // 45

  const webMessage = normalizeWebChatMessage({
    text: 'I sold 5 cartons of Indomie for 42500',
    businessId: biz1,
    senderName: 'Web Store Cashier',
    senderId: 'user_web_001',
  });

  const webResult = await ConversationProcessor.process(webMessage);
  assert(webResult.success === true, 'Web chat sale processing succeeded');
  assert(webResult.dashboardRefreshRequired === true, 'Web chat sale requires dashboard refresh');
  assert(webResult.channel === 'WEB', 'Web chat identifies channel as WEB');

  const afterWebProducts = await ProductService.listProducts(biz1);
  const afterWebIndomie = afterWebProducts.find(p => p.sku === 'IND-SUP-01')!;
  assert(afterWebIndomie.currentStock === startingStock1 - 5, `Web chat decremented stock to ${startingStock1 - 5} (actual: ${afterWebIndomie.currentStock})`);
  console.log('  TEST 1 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 2: A normalized WhatsApp message can create the same sale
  // -------------------------------------------------------------------------
  console.log('TEST 2: A normalized WhatsApp message can create the same sale');
  const biz2 = 'biz_test_wa';
  await firestoreDb.seedDemoCatalog(biz2);

  const waRawPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WHATSAPP_ACCOUNT_TEST',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '2348000000000', phone_number_id: 'wa_phone_test' },
          contacts: [{ profile: { name: 'Alhaji Bello' }, wa_id: '2348012345678' }],
          messages: [{
            from: '2348012345678',
            id: `wamid_sale_test_${Date.now()}`,
            timestamp: Math.floor(Date.now() / 1000).toString(),
            type: 'text',
            text: { body: 'I sold 5 cartons of Indomie for 42500' },
          }],
        },
        field: 'messages',
      }],
    }],
  };

  const normalizedWaList = normalizeMetaWebhook(waRawPayload, biz2);
  assert(normalizedWaList.length === 1, 'Webhook normalized exactly 1 message');
  const waIncoming = normalizedWaList[0];
  assert(waIncoming.provider === 'whatsapp_meta', 'Incoming message provider is whatsapp_meta');
  assert(waIncoming.senderPhone === '2348012345678', 'Sender phone parsed correctly');

  const waResult = await ConversationProcessor.process(waIncoming);
  assert(waResult.success === true, 'WhatsApp sale processing succeeded');
  assert(waResult.channel === 'WHATSAPP', 'Channel identified as WHATSAPP');

  const afterWaProducts = await ProductService.listProducts(biz2);
  const afterWaIndomie = afterWaProducts.find(p => p.sku === 'IND-SUP-01')!;
  assert(afterWaIndomie.currentStock === 40, `WhatsApp message decremented stock to 40 (actual: ${afterWaIndomie.currentStock})`);
  console.log('  TEST 2 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 3: Both channels use the same inventory service
  // -------------------------------------------------------------------------
  console.log('TEST 3: Both channels use the same inventory service');
  const biz3 = 'biz_test_shared_svc';
  await firestoreDb.seedDemoCatalog(biz3);
  const biz3Products = await ProductService.listProducts(biz3);
  const biz3Indomie = biz3Products.find(p => p.sku === 'IND-SUP-01')!;

  // Sale via Web Chat: 5 cartons
  const webMsg3 = normalizeWebChatMessage({
    text: 'Sell 5 cartons of Indomie',
    businessId: biz3,
  });
  await ConversationProcessor.process(webMsg3);

  // Sale via WhatsApp: 5 cartons
  const waMsg3 = normalizeGenericMessage({
    provider: 'whatsapp_meta',
    businessId: biz3,
    senderId: '2348099999999',
    text: 'Sell 5 cartons of Indomie',
  });
  await ConversationProcessor.process(waMsg3);

  // Both should reduce the same product balance through InventoryService
  const prodBalance = await InventoryService.getProductBalance(biz3Indomie.id);
  assert(prodBalance !== null, 'Product found via InventoryService');
  assert(prodBalance!.currentStock === 35, `Combined sales decremented stock to 35 (actual: ${prodBalance!.currentStock})`);

  // Verify transactions in shared ledger
  const txs = await InventoryService.getTransactions(biz3, 10);
  const indomieTxs = txs.filter(t => t.productId === biz3Indomie.id);
  assert(indomieTxs.length >= 2, 'Both channels recorded transactions in the shared audit ledger');
  console.log('  TEST 3 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 4: Duplicate WhatsApp messageId does not create a duplicate sale
  // -------------------------------------------------------------------------
  console.log('TEST 4: Duplicate WhatsApp messageId does not create a duplicate sale (Idempotency)');
  const biz4 = 'biz_test_idempotency';
  await firestoreDb.seedDemoCatalog(biz4);
  const biz4Products = await ProductService.listProducts(biz4);
  const biz4Indomie = biz4Products.find(p => p.sku === 'IND-SUP-01')!;

  const duplicateMessageId = `wamid_retry_unique_${Date.now()}`;
  const firstWaMsg = normalizeGenericMessage({
    messageId: duplicateMessageId,
    provider: 'whatsapp_meta',
    businessId: biz4,
    senderId: '2348088888888',
    text: 'Sell 5 cartons of Indomie',
  });

  const firstExecution = await ConversationProcessor.process(firstWaMsg);
  assert(firstExecution.success === true, 'First WhatsApp execution succeeded');
  const stockAfterFirst = (await db.getProduct(biz4Indomie.id))!.currentStock; // 40
  assert(stockAfterFirst === 40, `Stock after first sale is 40 (actual: ${stockAfterFirst})`);

  // Simulate webhook delivery retry with EXACT same messageId
  const retryWaMsg = normalizeGenericMessage({
    messageId: duplicateMessageId,
    provider: 'whatsapp_meta',
    businessId: biz4,
    senderId: '2348088888888',
    text: 'Sell 5 cartons of Indomie',
  });

  const secondExecution = await ConversationProcessor.process(retryWaMsg);
  assert(secondExecution.success === true, 'Second execution returns cached success response');

  const stockAfterRetry = (await db.getProduct(biz4Indomie.id))!.currentStock;
  assert(stockAfterRetry === 40, `Stock MUST remain 40 and NOT be double-decremented (actual: ${stockAfterRetry})`);
  console.log('  TEST 4 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 5: Clarification state survives between messages
  // -------------------------------------------------------------------------
  console.log('TEST 5: Clarification state survives between messages');
  const biz5 = 'biz_test_clarify';
  await firestoreDb.seedDemoCatalog(biz5);
  const biz5Products = await ProductService.listProducts(biz5);
  const biz5Indomie = biz5Products.find(p => p.sku === 'IND-SUP-01')!;

  const userPhone = '2348055555555';
  const session = await ConversationSessionService.getOrCreateSession('WHATSAPP', biz5, userPhone);

  // Set pending clarification for RECORD_SALE
  await ConversationSessionService.setPendingClarification(session, 'RECORD_SALE', {
    quantity: 5,
    partialQuery: 'Indomie',
  });

  assert(session.status === 'AWAITING_CLARIFICATION', 'Session status is AWAITING_CLARIFICATION');
  assert(session.pendingIntent === 'RECORD_SALE', 'Pending intent is RECORD_SALE');

  // Follow-up message providing the specific product variation
  const followUpMsg = normalizeGenericMessage({
    provider: 'whatsapp_meta',
    businessId: biz5,
    senderId: userPhone,
    text: 'Super Pack',
  });

  const followUpResult = await ConversationProcessor.process(followUpMsg);
  assert(followUpResult.success === true, 'Clarification follow-up executed the pending sale');
  assert(followUpResult.sessionStatus === 'ACTIVE', 'Session restored to ACTIVE');

  const clarifiedStock = (await db.getProduct(biz5Indomie.id))!.currentStock;
  assert(clarifiedStock === 40, `Clarified sale decremented stock from 45 to 40 (actual: ${clarifiedStock})`);
  console.log('  TEST 5 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 6: Different businesses remain isolated
  // -------------------------------------------------------------------------
  console.log('TEST 6: Different businesses remain isolated (Multi-Tenancy)');
  const bizAlpha = 'biz_tenant_alpha';
  const bizBeta = 'biz_tenant_beta';

  await firestoreDb.seedDemoCatalog(bizAlpha);
  await firestoreDb.seedDemoCatalog(bizBeta);

  // Sell 10 in Biz Alpha
  const msgAlpha = normalizeWebChatMessage({
    text: 'Sell 10 cartons of Indomie',
    businessId: bizAlpha,
  });
  await ConversationProcessor.process(msgAlpha);

  const stockAlpha = await ProductService.listProducts(bizAlpha);
  const indomieAlpha = stockAlpha.find(p => p.sku === 'IND-SUP-01');
  assert(indomieAlpha !== undefined, 'Indomie found in Biz Alpha');
  assert(indomieAlpha!.currentStock === 35, `Biz Alpha stock decremented to 35 (actual: ${indomieAlpha!.currentStock})`);

  const stockBeta = await ProductService.listProducts(bizBeta);
  const indomieBeta = stockBeta.find(p => p.sku === 'IND-SUP-01');
  assert(indomieBeta !== undefined, 'Indomie found in Biz Beta');
  assert(indomieBeta!.currentStock === 45, `Biz Beta stock must strictly remain 45 (actual: ${indomieBeta!.currentStock})`);
  console.log('  TEST 6 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 7: WhatsApp formatting hides internal database IDs
  // -------------------------------------------------------------------------
  console.log('TEST 7: WhatsApp formatting hides internal database IDs');
  const formattedSale = WhatsAppResponseFormatter.formatSale({
    invoiceNumber: 'INV-001234',
    productName: 'Indomie Super Pack',
    quantity: 5,
    unit: 'carton',
    totalAmount: 42500,
    amountPaid: 42500,
    balanceDue: 0,
    remainingStock: 40,
    currencySymbol: '₦',
  });

  console.log('Sample WhatsApp Message Output:\n' + formattedSale.split('\n').map(l => '   ' + l).join('\n'));

  assert(formattedSale.includes('✅ Sale recorded'), 'Contains clean sale headline');
  assert(formattedSale.includes('Indomie Super Pack'), 'Contains friendly product name');
  assert(formattedSale.includes('₦42,500'), 'Contains formatted currency');
  assert(formattedSale.includes('INV-001234'), 'Contains invoice number');
  assert(!formattedSale.includes('prod_'), 'Strictly hides internal product ID (prod_*)');
  assert(!formattedSale.includes('tx_'), 'Strictly hides internal transaction ID (tx_*)');
  assert(!formattedSale.includes('biz_'), 'Strictly hides internal business ID (biz_*)');
  assert(!formattedSale.includes('undefined'), 'Contains no undefined values');
  console.log('  TEST 7 PASSED.\n');

  // -------------------------------------------------------------------------
  // TEST 8: A failed transaction does not produce a success message
  // -------------------------------------------------------------------------
  console.log('TEST 8: A failed transaction does not produce a success message');
  const biz8 = 'biz_test_failure';
  await firestoreDb.seedDemoCatalog(biz8);

  const biz8Products = await ProductService.listProducts(biz8);
  const biz8Indomie = biz8Products.find(p => p.sku === 'IND-SUP-01')!;
  const initialStock8 = (await db.getProduct(biz8Indomie.id))!.currentStock; // 45

  // Attempt to oversell 500 cartons
  const oversellMsg = normalizeGenericMessage({
    provider: 'whatsapp_meta',
    businessId: biz8,
    senderId: '2348077777777',
    text: 'Sell 500 cartons of Indomie',
  });

  const failureResult = await ConversationProcessor.process(oversellMsg);
  assert(failureResult.success === false, 'Result success flag must be false for oversale');
  assert(!failureResult.text.includes('✅ Sale recorded'), 'Failed transaction MUST NOT contain success checkmark or "Sale recorded"');
  assert(failureResult.text.includes('❌ Insufficient stock'), 'Failure message clearly informs merchant of insufficient stock');

  const stockAfterFailed = (await db.getProduct(biz8Indomie.id))!.currentStock;
  assert(stockAfterFailed === initialStock8, `Stock remains exactly ${initialStock8} after rejected transaction (actual: ${stockAfterFailed})`);
  console.log('  TEST 8 PASSED.\n');

  console.log('================================================================');
  console.log('ALL 8 WHATSAPP ADAPTER & CONVERSATION TESTS PASSED PERFECTLY!');
  console.log('================================================================');
}

runWhatsAppAdapterTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
