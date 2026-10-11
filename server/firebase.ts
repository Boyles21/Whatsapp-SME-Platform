import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

let adminApp: App;

/**
 * Resolves Firebase Admin SDK credentials following production security standards:
 * 1. Prefers FIREBASE_SERVICE_ACCOUNT_KEY when explicitly provided (supports raw JSON or base64).
 * 2. Supports GOOGLE_APPLICATION_CREDENTIALS path if provided.
 * 3. Falls back to Application Default Credentials (ADC) for Google Cloud / Cloud Run environments.
 * 
 * Never hardcodes or logs private keys or sensitive credentials.
 */
function getAdminCredential() {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey && serviceAccountKey.trim()) {
    try {
      const raw = serviceAccountKey.trim();
      const parsed = raw.startsWith('{')
        ? JSON.parse(raw)
        : JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));

      if (parsed.project_id || parsed.client_email) {
        const maskedEmail = parsed.client_email ? `${parsed.client_email.split('@')[0]}@...` : 'service-account';
        console.log(`[FIREBASE_ADMIN] Initialized using FIREBASE_SERVICE_ACCOUNT_KEY (${maskedEmail})`);
        return cert(parsed);
      }
    } catch (err: any) {
      console.error('[FIREBASE_ADMIN] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:', err.message);
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('[FIREBASE_ADMIN] Initialized using GOOGLE_APPLICATION_CREDENTIALS file path');
    return applicationDefault();
  }

  console.log('[FIREBASE_ADMIN] Initialized using Application Default Credentials (ADC)');
  return applicationDefault();
}

if (getApps().length > 0) {
  adminApp = getApps()[0];
} else {
  adminApp = initializeApp({
    credential: getAdminCredential(),
    projectId: firebaseConfig.projectId,
  });
}

// Authoritative Firestore Admin instance bound to the applet's specific database
export const serverDb: Firestore = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
