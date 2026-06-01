import React, { createContext, useContext, useState, useEffect } from 'react';
import { loadStoredAccount, saveStoredAccount, clearStoredAccount, type StoredAccount } from '../services/storage/accountStorage';

export type UserMode = 'customer' | 'merchant';

type AuthContextType = {
  activeAccount: StoredAccount | null;
  connectedWalletPublicKey: string | null;
  userMode: UserMode;
  isAppReady: boolean;
  login: (publicKey: string, shortId: string, role: StoredAccount['role']) => Promise<void>;
  logout: () => Promise<void>;
  setUserMode: (mode: UserMode) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [activeAccount, setActiveAccount] = useState<StoredAccount | null>(null);
  const [connectedWalletPublicKey, setConnectedWalletPublicKey] = useState<string | null>(null);
  const [userMode, setUserMode] = useState<UserMode>('customer');
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      try {
        const account = await loadStoredAccount();
        if (!isMounted) return;
        if (account) {
          setActiveAccount(account);
          setConnectedWalletPublicKey(account.stellarPublicKey);
          setUserMode(account.role === 'MERCHANT' ? 'merchant' : 'customer');
        }
      } catch (error) {
        console.error('Failed to load stored account:', error);
      } finally {
        if (isMounted) {
          setIsAppReady(true);
        }
      }
    };
    bootstrap();
    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (publicKey: string, shortId: string, role: StoredAccount['role']) => {
    const account: StoredAccount = {
      shortId,
      role,
      stellarPublicKey: publicKey,
    };
    await saveStoredAccount(account);
    setActiveAccount(account);
    setConnectedWalletPublicKey(publicKey);
    setUserMode(role === 'MERCHANT' ? 'merchant' : 'customer');
  };

  const logout = async () => {
    await clearStoredAccount();
    setActiveAccount(null);
    setConnectedWalletPublicKey(null);
  };

  return (
    <AuthContext.Provider
      value={{
        activeAccount,
        connectedWalletPublicKey,
        userMode,
        isAppReady,
        login,
        logout,
        setUserMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
