import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  appUrl: string;
  geminiApiKey: string | null;
  firebaseServiceAccountKey: string | null;
  whatsappAccessToken: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  whatsappVerifyToken: string;
  metaAppSecret: string | null;
  isProduction: boolean;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  firebaseServiceAccountKey: process.env.FIREBASE_SERVICE_ACCOUNT_KEY || null,
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null,
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'sme_inventory_secret_token',
  metaAppSecret: process.env.META_APP_SECRET || null,
  isProduction: process.env.NODE_ENV === 'production',
};

/**
 * Validates configuration at startup and logs readiness without revealing secrets.
 */
export function validateStartupConfig(): { 
  valid: boolean; 
  warnings: string[]; 
  missingRequired: string[]; 
  missingOptional: string[]; 
  missing: string[]; 
} {
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  // Core requirements
  if (!process.env.GEMINI_API_KEY) {
    warnings.push('GEMINI_API_KEY is not configured (AI intent understanding will use rule-based fallback).');
  }

  const missingOptional: string[] = [];

  // Meta WhatsApp production credentials
  if (!process.env.META_APP_SECRET) {
    missingOptional.push('META_APP_SECRET');
    warnings.push('META_APP_SECRET is not set (Meta webhook HMAC signature verification will reject live webhooks).');
  }
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    missingOptional.push('WHATSAPP_ACCESS_TOKEN');
    warnings.push('WHATSAPP_ACCESS_TOKEN is not set (WhatsApp provider running in stub mode).');
  }
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
    missingOptional.push('WHATSAPP_PHONE_NUMBER_ID');
    warnings.push('WHATSAPP_PHONE_NUMBER_ID is not set.');
  }
  if (!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    missingOptional.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
    warnings.push('WHATSAPP_BUSINESS_ACCOUNT_ID is not set.');
  }

  console.log('[CONFIG] Startup configuration check:');
  console.log(`  - Firebase Admin: ${process.env.FIREBASE_SERVICE_ACCOUNT_KEY ? 'Service Account Key Configured' : (process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'Google App Credentials' : 'Application Default Credentials (ADC)')}`);
  console.log(`  - Gemini AI: ${config.geminiApiKey ? 'Configured' : 'Missing (Fallback)'}`);
  console.log(`  - Meta App Secret: ${config.metaAppSecret ? 'Configured' : 'Missing'}`);
  console.log(`  - WhatsApp Token: ${config.whatsappAccessToken ? 'Configured' : 'Missing (Stub mode)'}`);
  console.log(`  - WhatsApp Phone Number ID: ${config.whatsappPhoneNumberId ? 'Configured' : 'Missing'}`);
  console.log(`  - WhatsApp WABA ID: ${config.whatsappBusinessAccountId ? 'Configured' : 'Missing'}`);
  console.log(`  - Webhook Verify Token: ${process.env.WHATSAPP_VERIFY_TOKEN ? 'Custom' : 'Default'}`);

  return {
    valid: missingRequired.length === 0,
    warnings,
    missingRequired,
    missingOptional,
    missing: [...missingRequired, ...missingOptional],
  };
}
