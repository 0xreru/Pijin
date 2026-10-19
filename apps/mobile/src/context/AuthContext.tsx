import React, { createContext, useContext, useState, useEffect } from 'react';
import { loadStoredAccount, saveStoredAccount, clearStoredAccount, type StoredAccount } from '../services/storage/accountStorage';
import { getStoredJwt, setReauthHandler, setStoredJwt } from '../services/api/client';
import { getMainWalletSecret } from '../services/storage/onboardingStorage';
import { getSep10Token, Keypair } from '../services/stellar/anchorService';

export type UserMode = 'customer' | 'merchant';

type AuthContextType = {
  activeAccount: StoredAccount | null;
  connectedWalletPublicKey: string | null;
  jwt: string | null;
  userMode: UserMode;
  isAppReady: boolean;
  login: (publicKey: string, shortId: string, jwt?: string) => Promise<void>;
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
        if (account) {
          setActiveAccount(account);
          setConnectedWalletPublicKey(account.stellarPublicKey);
          if (token) {
            setJwt(token);
          }
          // Set userMode based on stored account or default to customer
          setUserMode('customer');
        } else if (token) {
          // Clean up orphaned token if account is missing
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

  // On a 401 the API client asks for a fresh SEP-10 token, signed with the
  // wallet key already on this device, and retries once — no logout needed.
  useEffect(() => {
    setReauthHandler(async () => {
      const secret = await getMainWalletSecret();
      if (!secret) return null;
      const token = await getSep10Token(Keypair.fromSecret(secret));
      setJwt(token);
      return token;
    });
    return () => setReauthHandler(null);
  }, []);

  const login = async (publicKey: string, shortId: string, token?: string) => {
    const account: StoredAccount = {
      shortId,
      role: 'USER',
      stellarPublicKey: publicKey,
    };
    await saveStoredAccount(account);
    if (token !== undefined) {
      await setStoredJwt(token);
      setJwt(token);
    }
    setActiveAccount(account);
    setConnectedWalletPublicKey(publicKey);
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
