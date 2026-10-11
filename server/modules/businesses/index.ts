import { db } from '../../db/storage.ts';
import { Business } from '../../types.ts';
import { firestoreDb } from '../../db/firestoreStorage.ts';

export class BusinessService {
  public static async getBusiness(businessId: string): Promise<Business> {
    let business = await db.getBusiness(businessId);
    if (!business) {
      // Auto-initialize business if not yet created
      const isDemo = businessId === 'biz_default' || businessId === 'biz_bello_01';
      const name = isDemo ? 'Bello Provisions & Groceries' : 'My Retail Business';
      const now = new Date().toISOString();
      const newBiz: Business = {
        businessId,
        id: businessId,
        name,
        businessType: 'Retail & Wholesale Provisions',
        currency: 'NGN',
        currencySymbol: '₦',
        country: 'Nigeria',
        ownerId: isDemo ? 'user_bello_01' : '',
        ownerName: isDemo ? 'Alhaji Bello' : 'Merchant',
        createdAt: now,
        updatedAt: now,
      };
      await firestoreDb.createBusiness(newBiz);
      if (isDemo) {
        await firestoreDb.seedDemoCatalog(businessId);
      }
      business = newBiz;
    }
    return business;
  }

  public static formatCurrency(amount: number, symbol: string = '₦'): string {
    return `${symbol}${amount.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
}
