import { serverDb } from '../../firebase.ts';
import { UserProfile, Business } from '../../types.ts';

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  businessId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
}

export class AuthService {
  private static defaultDemoUser: AuthContext = {
    userId: 'user_bello_01',
    email: 'bello@provisions.ng',
    name: 'Alhaji Bello',
    businessId: 'biz_bello_01',
    role: 'OWNER',
  };

  /**
   * Resolve user and their authoritative business from Firestore via Admin SDK
   */
  public static async resolveUserFromRequest(headers: Record<string, any>): Promise<AuthContext> {
    const authHeader = headers['authorization'] || headers['Authorization'];
    const userIdHeader = headers['x-user-id'];
    
    let candidateUid = '';
    if (typeof userIdHeader === 'string' && userIdHeader.trim()) {
      candidateUid = userIdHeader.trim();
    } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      candidateUid = authHeader.replace('Bearer ', '').trim();
    }

    if (!candidateUid || candidateUid === 'undefined' || candidateUid === 'null') {
      return this.defaultDemoUser;
    }

    try {
      const userDoc = await serverDb.collection('users').doc(candidateUid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        return {
          userId: candidateUid,
          email: data.email || 'user@business.ng',
          name: data.name || 'Merchant',
          businessId: data.businessId || `biz_${candidateUid}`,
          role: data.role || 'OWNER',
        };
      }
    } catch (err: any) {
      // Non-blocking fallback for local tests and unseeded tokens
    }

    return {
      userId: candidateUid,
      email: 'merchant@business.ng',
      name: 'Store Owner',
      businessId: `biz_${candidateUid}`,
      role: 'OWNER',
    };
  }

  public static getDefaultDemoUser(): AuthContext {
    return { ...this.defaultDemoUser };
  }

  public static getCurrentUser(): AuthContext {
    return { ...this.defaultDemoUser };
  }
}
