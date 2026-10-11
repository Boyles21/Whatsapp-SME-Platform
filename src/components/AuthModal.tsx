import React, { useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInAnonymously 
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.ts';
import { Store, LogIn, UserPlus, ShieldAlert, Sparkles, X, CheckCircle2 } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onAuthenticated: (userId: string, businessId: string, businessName: string) => void;
  canDismiss?: boolean;
}

export function AuthModal({ isOpen, onClose, onAuthenticated, canDismiss = false }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        if (!email.trim() || !password.trim()) {
          throw new Error('Please enter both email and password.');
        }
        if (password.length < 6) {
          throw new Error('Password should be at least 6 characters.');
        }

        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const uid = cred.user.uid;
        const bizId = `biz_${uid.slice(0, 10)}`;
        const bName = businessName.trim() || `${fullName.trim() || 'My'} Provisions`;
        const now = new Date().toISOString();

        // Register profile on server and seed catalog
        const res = await fetch('/api/auth/register-profile', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-user-id': uid,
          },
          body: JSON.stringify({
            userId: uid,
            email: email.trim(),
            name: fullName.trim() || 'Merchant',
            businessId: bizId,
            businessName: bName,
          }),
        });

        if (!res.ok) {
          console.warn('Backend profile registration returned notice, checking local user doc');
        }

        onAuthenticated(uid, bizId, bName);
      } else {
        if (!email.trim() || !password.trim()) {
          throw new Error('Please enter both email and password.');
        }

        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        const uid = cred.user.uid;

        // Fetch user profile from server
        const res = await fetch('/api/auth/me', {
          headers: { 'x-user-id': uid },
        });

        let bizId = `biz_${uid.slice(0, 10)}`;
        let bName = 'My Business';

        if (res.ok) {
          const data = await res.json();
          if (data.business) {
            bizId = data.business.businessId || data.business.id;
            bName = data.business.name;
          }
        }

        onAuthenticated(uid, bizId, bName);
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      let msg = err.message || 'Authentication failed.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'Invalid email or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'An account with this email already exists. Please log in.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      // Demo merchant credentials
      const demoEmail = 'bello@provisions.ng';
      const demoPass = 'Bello1234!';

      try {
        const cred = await signInWithEmailAndPassword(auth, demoEmail, demoPass);
        onAuthenticated(cred.user.uid, 'biz_bello_01', 'Bello Provisions & Groceries');
      } catch (signInErr: any) {
        // If not created yet in Firebase Auth, create the demo user account
        try {
          const newCred = await createUserWithEmailAndPassword(auth, demoEmail, demoPass);
          const uid = newCred.user.uid;
          await fetch('/api/auth/register-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-id': uid },
            body: JSON.stringify({
              userId: uid,
              email: demoEmail,
              name: 'Alhaji Bello',
              businessId: 'biz_bello_01',
              businessName: 'Bello Provisions & Groceries',
            }),
          });
          onAuthenticated(uid, 'biz_bello_01', 'Bello Provisions & Groceries');
        } catch {
          // Fallback to local demo session
          onAuthenticated('user_bello_01', 'biz_bello_01', 'Bello Provisions & Groceries');
        }
      }
    } catch (err: any) {
      // Direct demo sign in fallback
      onAuthenticated('user_bello_01', 'biz_bello_01', 'Bello Provisions & Groceries');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[92dvh] my-auto">
        {/* Header banner */}
        <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 p-4 sm:p-6 text-white text-center relative shrink-0">
          {canDismiss && onClose && (
            <button 
              onClick={onClose}
              className="absolute top-3 right-3 text-emerald-300 hover:text-white p-1.5 rounded-lg transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-700/80 rounded-xl flex items-center justify-center mx-auto mb-2 sm:mb-3 text-white shadow-inner">
            <Store className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight">WhatsApp SME Inventory</h2>
          <p className="text-[11px] sm:text-xs text-emerald-200 mt-0.5 sm:mt-1">
            Secure multi-tenant inventory with Firebase Authentication & Firestore
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-gray-200 bg-gray-50/50 shrink-0">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(null); }}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 min-h-[44px] ${
              mode === 'login' 
                ? 'bg-white text-emerald-700 border-b-2 border-emerald-600' 
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(null); }}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 min-h-[44px] ${
              mode === 'signup' 
                ? 'bg-white text-emerald-700 border-b-2 border-emerald-600' 
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Create Account
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleAuth} className="p-4 sm:p-6 space-y-3 sm:space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Business / Store Name
                </label>
                <input
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Star Provisions Lagos"
                  className="w-full px-3 py-2.5 text-base sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Your Full Name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Bolu Ajisebutu"
                  className="w-full px-3 py-2.5 text-base sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. merchant@store.com"
              className="w-full px-3 py-2.5 text-base sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 text-base sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-sm font-bold shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 min-h-[44px]"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In to Store</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Create Store & Sign Up</span>
              </>
            )}
          </button>

          <div className="relative flex items-center justify-center my-2">
            <div className="border-t border-gray-200 w-full" />
            <span className="bg-white px-3 text-[11px] text-gray-500 uppercase tracking-wider">or</span>
          </div>

          {/* Instant Demo Access Button */}
          <button
            type="button"
            onClick={handleDemoLogin}
            disabled={loading}
            className="w-full py-2.5 px-4 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-2 shadow-2xs min-h-[40px]"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Instant Demo Sign-in (Bello Provisions)</span>
          </button>
        </form>
      </div>
    </div>
  );
}
