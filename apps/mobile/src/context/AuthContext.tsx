import React, { createContext, useContext, useState, useEffect } from 'react';
import { loadStoredAccount, saveStoredAccount, clearStoredAccount, type StoredAccount } from '../services/storage/accountStorage';
import { getStoredJwt, setStoredJwt } from '../services/api/client';

export type UserMode = 'customer' | 'merchant';

type AuthContextType = {
  activeAccount: StoredAccount | null;
  connectedWalletPublicKey: string | null;
  jwt: string | null;
  userMode: UserMode;
  isAppReady: boolean;
  login: (publicKey: string, shortId: string, jwt: string) => Promise<void>;
  logout: () => Promise<void>;
  setUserMode: (mode: UserMode) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [activeAccount, setActiveAccount] = useState<StoredAccount | null>(null);
  const [connectedWalletPublicKey, setConnectedWalletPublicKey] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [userMode, setUserMode] = useState<UserMode>('customer');
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      try {
        const account = await loadStoredAccount();
        const token = await getStoredJwt();
        if (!isMounted) return;
        if (account && token) {
          setActiveAccount(account);
          setConnectedWalletPublicKey(account.stellarPublicKey);
          setJwt(token);
          // Set userMode based on stored account or default to customer
          setUserMode('customer');
        } else if (account || token) {
          // Clean up partial states
          await clearStoredAccount();
          await setStoredJwt(null);
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

  const login = async (publicKey: string, shortId: string, token: string) => {
    const account: StoredAccount = {
      shortId,
      role: 'USER',
      stellarPublicKey: publicKey,
    };
    await saveStoredAccount(account);
    await setStoredJwt(token);
    setActiveAccount(account);
    setConnectedWalletPublicKey(publicKey);
    setJwt(token);
    setUserMode('customer');
  };

  const logout = async () => {
    await clearStoredAccount();
    await setStoredJwt(null);
    setActiveAccount(null);
    setConnectedWalletPublicKey(null);
    setJwt(null);
  };

  return (
    <AuthContext.Provider
      value={{
        activeAccount,
        connectedWalletPublicKey,
        jwt,
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
