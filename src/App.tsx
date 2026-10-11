import React, { useState, useEffect, useCallback } from 'react';
import { 
  MessageSquare, 
  LayoutDashboard, 
  Columns, 
  RotateCcw, 
  Store, 
  UserCheck, 
  Sparkles,
  ShieldCheck,
  LogOut,
  LogIn,
  Package,
  ShoppingBag
} from 'lucide-react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase.ts';

import { WhatsAppChat } from './components/WhatsAppChat.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { CreateProductModal } from './components/CreateProductModal.tsx';
import { AddStockModal } from './components/AddStockModal.tsx';
import { AuthModal } from './components/AuthModal.tsx';

import { 
  DashboardData, 
  Product, 
  InventoryTransaction, 
  Sale, 
  AuditLog, 
  ChatMessage 
} from './types.ts';

export default function App() {
  const [viewMode, setViewMode] = useState<'split' | 'chat' | 'dashboard'>('split');
  const [dashboardTab, setDashboardTab] = useState<'products' | 'transactions' | 'sales' | 'audit'>('products');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  // Authentication state
  const [authUser, setAuthUser] = useState<{
    uid: string;
    email: string | null;
    name: string;
    businessId: string;
    businessName: string;
  } | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Modals state
  const [isCreateProductOpen, setIsCreateProductOpen] = useState(false);
  const [selectedProductForStock, setSelectedProductForStock] = useState<Product | null>(null);

  // Data states
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // WhatsApp Messages state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome_1',
      sender: 'assistant',
      text: `👋 *Welcome to your WhatsApp Inventory Assistant!*\n\nI am connected to *Bello Provisions & Groceries*. Every transaction you perform is processed atomically with persistent Firebase data and full audit history.\n\nTry testing any of these commands:\n• *"Add 50 cartons of Indomie at 7500 each"*\n• *"I sold 5 cartons of Indomie for 42500"*\n• *"How much Indomie do I have?"*\n• *"What did I sell today?"*\n• *"Which products are low?"*`,
      timestamp: new Date().toISOString(),
      status: 'read',
      structuredData: {
        type: 'CLARIFICATION_NEEDED',
        suggestedActions: [
          'Add 50 cartons of Indomie at 7500 each',
          'I sold 5 cartons of Indomie for 42500',
          'How much Indomie do I have?',
          'What did I sell today?',
          'Which products are low?',
        ],
      },
    },
  ]);

  // Window resize listener
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile && viewMode === 'split') {
        setViewMode('chat');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewMode]);

  // Load all initial data from backend with authoritative user/business headers
  const loadData = useCallback(async (currentUid?: string) => {
    try {
      setIsLoading(true);
      const uid = currentUid || authUser?.uid || 'user_bello_01';
      const headers = { 'x-user-id': uid };

      const [dashRes, prodRes, txRes, saleRes, auditRes] = await Promise.all([
        fetch('/api/dashboard', { headers }),
        fetch('/api/products', { headers }),
        fetch('/api/inventory/transactions?limit=30', { headers }),
        fetch('/api/sales?limit=30', { headers }),
        fetch('/api/audit-logs?limit=30', { headers }),
      ]);

      if (dashRes.ok) {
        const d = await dashRes.json();
        setDashboardData(d);
      }
      if (prodRes.ok) {
        const p = await prodRes.json();
        setProducts(p.products || []);
      }
      if (txRes.ok) {
        const t = await txRes.json();
        setTransactions(t.transactions || []);
      }
      if (saleRes.ok) {
        const s = await saleRes.json();
        setSales(s.sales || []);
      }
      if (auditRes.ok) {
        const a = await auditRes.json();
        setAuditLogs(a.auditLogs || []);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authUser?.uid]);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: { 'x-user-id': user.uid },
          });
          if (res.ok) {
            const data = await res.json();
            const b = data.business || {};
            setAuthUser({
              uid: user.uid,
              email: user.email,
              name: data.user?.name || user.displayName || 'Merchant',
              businessId: b.businessId || b.id || `biz_${user.uid.slice(0, 10)}`,
              businessName: b.name || 'My Provisions Store',
            });
          } else {
            setAuthUser({
              uid: user.uid,
              email: user.email,
              name: user.displayName || 'Merchant',
              businessId: `biz_${user.uid.slice(0, 10)}`,
              businessName: 'My Provisions Store',
            });
          }
        } catch (err) {
          console.error('Error loading user profile:', err);
        }
        await loadData(user.uid);
      } else {
        setAuthUser(null);
        await loadData('user_bello_01');
      }
    });

    return () => unsubscribe();
  }, [loadData]);

  // Handle successful login
  const handleAuthenticated = async (userId: string, businessId: string, businessName: string) => {
    setIsAuthModalOpen(false);
    await loadData(userId);
    setMessages((prev) => [
      ...prev,
      {
        id: `login_${Date.now()}`,
        sender: 'assistant',
        text: `🔐 *Authenticated as ${businessName}*\n\nYour session is now loaded with persistent catalog and Firestore audit logs.`,
        timestamp: new Date().toISOString(),
        status: 'read',
      },
    ]);
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAuthUser(null);
      await loadData('user_bello_01');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Handle sending a WhatsApp chat message through backend assistant
  const handleSendMessage = async (text: string) => {
    const userMsgId = `user_${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text,
      timestamp: new Date().toISOString(),
      status: 'delivered',
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);

    try {
      const uid = authUser?.uid || 'user_bello_01';
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': uid,
        },
        body: JSON.stringify({
          message: text,
          conversationHistory: messages.slice(-8).map(m => ({
            role: m.sender === 'user' ? 'user' : 'model',
            parts: [{ text: m.text }],
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to process message');
      }

      const botMessage: ChatMessage = {
        id: data.replyId || `bot_${Date.now()}`,
        sender: 'assistant',
        text: data.replyText || 'I processed your request.',
        timestamp: new Date().toISOString(),
        status: 'read',
        structuredData: data.structuredData,
      };

      setMessages((prev) => [...prev, botMessage]);

      // If backend tool updated data, automatically refresh live dashboard state
      if (data.requiresDataRefresh) {
        await loadData(uid);
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: 'assistant',
        text: `⚠️ *An error occurred:* ${err.message || 'Could not communicate with the inventory engine.'}`,
        timestamp: new Date().toISOString(),
        status: 'read',
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  };

  // Reset demo
  const handleResetDemo = async () => {
    if (!confirm('Reset inventory and sales database to default seed state in Firebase Firestore?')) return;
    try {
      setIsLoading(true);
      const uid = authUser?.uid || 'user_bello_01';
      await fetch('/api/demo/reset', { 
        method: 'POST',
        headers: { 'x-user-id': uid },
      });
      await loadData(uid);
      setMessages([
        {
          id: `reset_${Date.now()}`,
          sender: 'assistant',
          text: `🔄 *Firestore database has been reset to default SME catalog.* You can start a fresh inventory session now!`,
          timestamp: new Date().toISOString(),
          status: 'read',
        },
      ]);
    } catch (err) {
      console.error('Error resetting demo:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Determine active view mode (on mobile, 'split' falls back to 'chat')
  const effectiveViewMode = isMobile && viewMode === 'split' ? 'chat' : viewMode;

  return (
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] w-screen bg-gray-100 overflow-hidden text-gray-900 font-sans">
      {/* Top Application Bar */}
      <header className="bg-emerald-950 text-white px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between border-b border-emerald-900 z-30 shrink-0 h-14">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-black shadow-xs shrink-0">
            <Store className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="font-bold text-xs sm:text-sm tracking-tight flex items-center gap-1.5 truncate">
              <span className="truncate">WhatsApp SME</span>
              <span className="text-[9px] sm:text-[10px] bg-emerald-800 text-emerald-200 px-1.5 py-0.2 rounded font-mono shrink-0">Firebase</span>
            </span>
            <span className="text-[10px] sm:text-[11px] text-emerald-300 block leading-none truncate">
              {dashboardData?.businessName || authUser?.businessName || 'Bello Provisions'} • ₦ NGN
            </span>
          </div>
        </div>

        {/* View Switcher Controls (Desktop / Tablet) */}
        <div className="hidden md:flex items-center gap-1 bg-emerald-900/70 p-1 rounded-lg border border-emerald-800/80">
          <button
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              viewMode === 'split'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-emerald-300 hover:text-white'
            }`}
            title="Split view (WhatsApp on left, Live Dashboard on right)"
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Split View</span>
          </button>

          <button
            onClick={() => setViewMode('chat')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              viewMode === 'chat'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-emerald-300 hover:text-white'
            }`}
            title="WhatsApp Chat only"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </button>

          <button
            onClick={() => setViewMode('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              viewMode === 'dashboard'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-emerald-300 hover:text-white'
            }`}
            title="Inventory Dashboard only"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>
        </div>

        {/* User context, Auth & Reset Demo */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {authUser ? (
            <div className="hidden lg:flex items-center gap-1.5 text-xs bg-emerald-900/60 px-2.5 py-1 rounded-md border border-emerald-800 text-emerald-200">
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="truncate max-w-[140px]">{authUser.name}</span>
            </div>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 px-2.5 py-1.5 rounded-md text-white font-semibold transition-colors min-h-[34px]"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}

          {authUser && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 text-emerald-300 hover:text-rose-300 bg-emerald-900/40 hover:bg-rose-950/60 rounded-md transition-colors border border-emerald-800/60 min-h-[34px]"
              title="Sign out of current business account"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          )}

          <button
            onClick={handleResetDemo}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 text-emerald-300 hover:text-white bg-emerald-900/40 hover:bg-emerald-800/80 rounded-md transition-colors min-h-[34px]"
            title="Reset Firestore database to fresh demo state"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Main Workspace: Split or Single View with mobile bottom bar spacing */}
      <main className="flex-1 flex overflow-hidden relative pb-[58px] md:pb-0">
        {/* WhatsApp Chat Panel */}
        <div
          className={`h-full flex flex-col transition-all duration-200 ${
            effectiveViewMode === 'chat'
              ? 'w-full'
              : effectiveViewMode === 'split'
              ? 'w-full md:w-[380px] lg:w-[440px] xl:w-[480px] shrink-0 border-r border-gray-300'
              : 'hidden'
          }`}
        >
          <WhatsAppChat
            messages={messages}
            onSendMessage={handleSendMessage}
            isSending={isSending}
            currencySymbol={dashboardData?.currencySymbol || '₦'}
            businessName={dashboardData?.businessName || authUser?.businessName || 'Bello Provisions'}
            onSwitchToDashboard={() => {
              setViewMode('dashboard');
              setDashboardTab('products');
            }}
          />
        </div>

        {/* Live Inventory Dashboard Panel */}
        <div
          className={`h-full flex-1 flex flex-col overflow-hidden bg-gray-50 transition-all duration-200 ${
            effectiveViewMode === 'dashboard'
              ? 'w-full'
              : effectiveViewMode === 'split'
              ? 'hidden md:flex'
              : 'hidden'
          }`}
        >
          <DashboardView
            data={dashboardData}
            products={products}
            transactions={transactions}
            sales={sales}
            auditLogs={auditLogs}
            isLoading={isLoading}
            onRefresh={() => loadData()}
            onOpenCreateProduct={() => setIsCreateProductOpen(true)}
            onOpenAddStock={(p) => setSelectedProductForStock(p)}
            activeTab={dashboardTab}
            onTabChange={setDashboardTab}
          />
        </div>
      </main>

      {/* Mobile Ergonomic Bottom Navigation Bar (Visible only on < 768px screens) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 px-1 py-1 pb-safe flex items-center justify-around shadow-lg h-[58px]">
        <button
          onClick={() => setViewMode('chat')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[44px] ${
            effectiveViewMode === 'chat' 
              ? 'text-emerald-700 font-bold' 
              : 'text-gray-500 hover:text-gray-800 font-medium'
          }`}
        >
          <div className="relative">
            <MessageSquare className="w-5 h-5" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full" />
          </div>
          <span className="text-[10px] mt-0.5">WhatsApp</span>
        </button>

        <button
          onClick={() => {
            setViewMode('dashboard');
            setDashboardTab('products');
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[44px] ${
            effectiveViewMode === 'dashboard' && dashboardTab === 'products'
              ? 'text-emerald-700 font-bold' 
              : 'text-gray-500 hover:text-gray-800 font-medium'
          }`}
        >
          <Package className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Products</span>
        </button>

        <button
          onClick={() => {
            setViewMode('dashboard');
            setDashboardTab('sales');
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[44px] ${
            effectiveViewMode === 'dashboard' && dashboardTab === 'sales'
              ? 'text-emerald-700 font-bold' 
              : 'text-gray-500 hover:text-gray-800 font-medium'
          }`}
        >
          <ShoppingBag className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Sales</span>
        </button>

        <button
          onClick={() => {
            setViewMode('dashboard');
            setDashboardTab('transactions');
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors min-h-[44px] ${
            effectiveViewMode === 'dashboard' && (dashboardTab === 'transactions' || dashboardTab === 'audit')
              ? 'text-emerald-700 font-bold' 
              : 'text-gray-500 hover:text-gray-800 font-medium'
          }`}
        >
          <ShieldCheck className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Audit</span>
        </button>
      </nav>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        canDismiss={!!authUser}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />

      {/* Create Product Modal */}
      <CreateProductModal
        isOpen={isCreateProductOpen}
        onClose={() => setIsCreateProductOpen(false)}
        onProductCreated={() => {
          loadData();
          setMessages((prev) => [
            ...prev,
            {
              id: `prod_added_${Date.now()}`,
              sender: 'assistant',
              text: `📦 *Product created in Firestore database.* You can now record stock additions and sales for this item.`,
              timestamp: new Date().toISOString(),
              status: 'read',
            },
          ]);
        }}
        currencySymbol={dashboardData?.currencySymbol || '₦'}
      />

      {/* Quick Add Stock Modal */}
      <AddStockModal
        isOpen={!!selectedProductForStock}
        product={selectedProductForStock}
        onClose={() => setSelectedProductForStock(null)}
        onStockAdded={() => {
          loadData();
          if (selectedProductForStock) {
            setMessages((prev) => [
              ...prev,
              {
                id: `stock_added_${Date.now()}`,
                sender: 'assistant',
                text: `✅ *Stock replenished in Firestore for ${selectedProductForStock.name}.* Updated inventory balance and transaction logged.`,
                timestamp: new Date().toISOString(),
                status: 'read',
              },
            ]);
          }
        }}
        currencySymbol={dashboardData?.currencySymbol || '₦'}
      />
    </div>
  );
}
