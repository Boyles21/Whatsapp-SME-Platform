import crypto from 'crypto';
import { config } from '../../server/config.ts';
import { WhatsAppLogger } from '../logger.ts';

export interface SignatureVerificationResult {
  isValid: boolean;
  statusCode: number;
  reason: string;
}

/**
 * Validates Meta WhatsApp Webhook X-Hub-Signature-256.
 * Computes HMAC-SHA256 over raw body buffer and compares using timingSafeEqual.
 * Never logs the secret or signature values.
 */
export function verifyMetaSignature(
  rawBody: Buffer | string | undefined,
  headerSignature: string | string[] | undefined,
  appSecretOverride?: string | null
): SignatureVerificationResult {
  const secret = appSecretOverride !== undefined ? appSecretOverride : config.metaAppSecret;

  // Blocker requirement: If META_APP_SECRET is not configured, fail safely
  if (!secret) {
    WhatsAppLogger.log({
      event: 'webhook_rejected',
      reason: 'META_APP_SECRET is not configured on the server. Rejecting webhook for safety.',
    });
    return {
      isValid: false,
      statusCode: 401,
      reason: 'Server webhook secret configuration missing',
    };
  }

  if (!headerSignature || typeof headerSignature !== 'string') {
    WhatsAppLogger.log({
      event: 'webhook_rejected',
      reason: 'Missing or malformed X-Hub-Signature-256 header',
    });
    return {
      isValid: false,
      statusCode: 401,
      reason: 'Missing X-Hub-Signature-256 header',
    };
  }

  if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0)) {
    WhatsAppLogger.log({
      event: 'webhook_rejected',
      reason: 'Empty webhook request body',
    });
    return {
      isValid: false,
      statusCode: 401,
      reason: 'Empty request body',
    };
  }

  // Meta signature format is: sha256=<hex_digest>
  const prefix = 'sha256=';
  if (!headerSignature.startsWith(prefix)) {
    WhatsAppLogger.log({
      event: 'webhook_rejected',
      reason: 'Invalid signature algorithm prefix (expected sha256=)',
    });
    return {
      isValid: false,
      statusCode: 401,
      reason: 'Invalid signature format',
    };
  }

  const providedHash = headerSignature.substring(prefix.length).trim();

  try {
    const hmac = crypto.createHmac('sha256', secret);
    if (Buffer.isBuffer(rawBody)) {
      hmac.update(rawBody);
    } else {
      hmac.update(Buffer.from(rawBody, 'utf-8'));
    }
    const computedHash = hmac.digest('hex');

    const expectedBuffer = Buffer.from(computedHash, 'utf8');
    const providedBuffer = Buffer.from(providedHash, 'utf8');

    if (expectedBuffer.length !== providedBuffer.length) {
      WhatsAppLogger.log({
        event: 'webhook_rejected',
        reason: 'HMAC signature length mismatch',
      });
      return {
        isValid: false,
        statusCode: 401,
        reason: 'Signature mismatch',
      };
    }

    const matches = crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    if (!matches) {
      WhatsAppLogger.log({
        event: 'webhook_rejected',
        reason: 'HMAC signature hash mismatch',
      });
      return {
        isValid: false,
        statusCode: 401,
        reason: 'Signature mismatch',
      };
    }

    return {
      isValid: true,
      statusCode: 200,
      reason: 'Signature verified successfully',
    };
  } catch (err: any) {
    WhatsAppLogger.log({
      event: 'webhook_rejected',
      reason: 'Cryptographic comparison failure',
      error: err.message,
    });
    return {
      isValid: false,
      statusCode: 401,
      reason: 'Cryptographic verification error',
    };
  }
}

/**
 * Computes the X-Hub-Signature-256 header value for a given payload and secret.
 * Used for testing and outgoing signature verification.
 */
export function computeMetaSignature(payload: Buffer | string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else {
    hmac.update(Buffer.from(payload, 'utf-8'));
  }
  return `sha256=${hmac.digest('hex')}`;
}
