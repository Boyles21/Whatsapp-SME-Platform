import { db, IDatabaseStorage } from '../../db/storage.ts';
import { Customer, Payment } from '../../types.ts';
import { AuditService } from '../audit/index.ts';

export class CustomerService {
  public static async getCustomer(id: string): Promise<Customer | null> {
    return db.getCustomer(id);
  }

  public static async getCustomers(businessId: string): Promise<Customer[]> {
    return (db as any).getCustomers ? await (db as any).getCustomers(businessId) : [];
  }

  public static async resolveCustomer(
    storage: IDatabaseStorage,
    businessId: string,
    customerName?: string,
    phone?: string
  ): Promise<Customer | null> {
    if (!customerName || customerName.trim().length === 0) {
      return null;
    }
    return storage.findOrCreateCustomer(businessId, customerName.trim(), phone);
  }

  public static async createCustomer(
    businessId: string,
    actor: string,
    data: { name: string; phone?: string }
  ): Promise<Customer> {
    const customer = await db.findOrCreateCustomer(businessId, data.name, data.phone);
    await AuditService.recordLog(db, {
      businessId,
      actor,
      action: 'CUSTOMER_CREATED',
      entityType: 'CUSTOMER',
      entityId: customer.customerId || customer.id || '',
      beforeState: null,
      afterState: customer,
      metadata: { name: customer.name, phone: customer.phone },
    });
    return customer;
  }

  public static async getCustomerBalance(
    businessId: string,
    nameOrId: string
  ): Promise<{ customer: Customer | null; balance: number; totalPurchases: number }> {
    const { customer, balance } = await db.getCustomerBalance(businessId, nameOrId);
    return {
      customer,
      balance,
      totalPurchases: Number(customer?.totalPurchases || 0),
    };
  }

  /**
   * Records a customer debt payment atomically.
   * Decrements outstanding balance, records payment entity, and writes an audit log.
   */
  public static async recordCustomerPayment(
    businessId: string,
    actor: string,
    params: {
      customerNameOrId: string;
      amount: number;
      method?: string;
      reference?: string;
      notes?: string;
    }
  ): Promise<{
    customer: Customer;
    payment: Payment;
    previousBalance: number;
    amountPaid: number;
    newBalance: number;
  }> {
    if (typeof params.amount !== 'number' || isNaN(params.amount) || params.amount <= 0) {
      throw new Error(`Invalid payment amount (${params.amount}). Must be greater than zero.`);
    }

    // Resolve customer before transaction to ensure existing ID
    const preCustomer = await CustomerService.resolveCustomer(db, businessId, params.customerNameOrId);
    const resolvedCustomer = preCustomer || (await db.findOrCreateCustomer(businessId, params.customerNameOrId));
    const custId = resolvedCustomer.customerId || resolvedCustomer.id || '';

    return db.runInTransaction(async (txStorage: IDatabaseStorage) => {
      // 1. ALL READS FIRST (read customer within transaction for optimistic concurrency lock)
      const customer = await txStorage.getCustomer(custId);
      if (!customer) {
        throw new Error(`Customer "${params.customerNameOrId}" not found.`);
      }

      const previousBalance = Number(customer.balance || 0);
      const deduction = Math.min(previousBalance, params.amount);
      const newBalance = Math.max(0, previousBalance - params.amount);

      // 2. ALL WRITES AFTER READS (strictly through fsTx inside the same transaction)
      if (txStorage.updateCustomerBalance) {
        await txStorage.updateCustomerBalance(custId, -deduction, 0, customer);
      }

      const payment = await txStorage.recordPayment({
        businessId,
        customerId: custId,
        amount: params.amount,
        method: params.method || 'CASH',
        reference: params.reference || `PAY-${Date.now()}`,
        recordedBy: actor,
      });

      const paymentId = payment.paymentId || payment.id || `pay_${Date.now()}`;

      await AuditService.recordLog(txStorage, {
        businessId,
        actor,
        action: 'PAYMENT_RECORDED',
        entityType: 'PAYMENT',
        entityId: paymentId,
        beforeState: { balance: previousBalance },
        afterState: { balance: newBalance, paymentAmount: params.amount },
        metadata: {
          customerId: custId,
          customerName: customer.name,
          paymentId,
          method: params.method || 'CASH',
          reference: payment.reference,
        },
      });

      const updatedCustomer: Customer = {
        ...customer,
        balance: newBalance,
      };

      return {
        customer: updatedCustomer,
        payment,
        previousBalance,
        amountPaid: params.amount,
        newBalance,
      };
    });
  }

  /**
   * Retrieves all customers with outstanding debt balances.
   */
  public static async getDebtors(businessId: string): Promise<{
    debtors: Customer[];
    totalOutstandingDebt: number;
    debtorCount: number;
  }> {
    const customers = await this.getCustomers(businessId);
    const debtors = customers.filter(c => Number(c.balance || 0) > 0);
    const totalOutstandingDebt = debtors.reduce((sum, c) => sum + Number(c.balance || 0), 0);

    return {
      debtors: debtors.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0)),
      totalOutstandingDebt,
      debtorCount: debtors.length,
    };
  }
}
