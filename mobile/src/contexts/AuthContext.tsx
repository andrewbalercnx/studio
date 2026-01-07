import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';

// Since @react-native-firebase requires native modules, we'll use REST API for auth
// This allows us to build with Expo Go for development

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const FIREBASE_API_KEY = 'AIzaSyBnmgkx6nfE8hgOqdcgeErOs0SzXVAnXmI'; // From Firebase config
const TOKEN_STORAGE_KEY = 'storypic_auth_token';
const USER_STORAGE_KEY = 'storypic_auth_user';
const REFRESH_TOKEN_KEY = 'storypic_refresh_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    loading: true,
    error: null,
  });

  // Load stored auth on mount
  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const [storedToken, storedUser, storedRefresh] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_STORAGE_KEY),
        SecureStore.getItemAsync(USER_STORAGE_KEY),
        SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      ]);

      if (storedToken && storedUser) {
        const user = JSON.parse(storedUser);

        // Try to refresh the token if we have a refresh token
        if (storedRefresh) {
          try {
            const newToken = await refreshIdToken(storedRefresh);
            setState({
              user,
              token: newToken,
              loading: false,
              error: null,
            });
            await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, newToken);
            return;
          } catch (e) {
            // Refresh failed, clear stored data
            console.warn('Token refresh failed:', e);
          }
        }

        // Use stored token (might be expired)
        setState({
          user,
          token: storedToken,
          loading: false,
          error: null,
        });
      } else {
        setState(prev => ({ ...prev, loading: false }));
      }
    } catch (e) {
      console.error('Error loading stored auth:', e);
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  const refreshIdToken = async (refreshToken: string): Promise<string> => {
    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();
    return data.id_token;
  };

  const signIn = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Use Firebase REST API for sign in
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            returnSecureToken: true,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Sign in failed');
      }

      const user: User = {
        uid: data.localId,
        email: data.email,
        displayName: data.displayName || null,
      };

      // Store auth data
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_STORAGE_KEY, data.idToken),
        SecureStore.setItemAsync(USER_STORAGE_KEY, JSON.stringify(user)),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken),
      ]);

      setState({
        user,
        token: data.idToken,
        loading: false,
        error: null,
      });
    } catch (e: any) {
      const errorMessage = e.message === 'INVALID_LOGIN_CREDENTIALS'
        ? 'Invalid email or password'
        : e.message || 'Sign in failed';

      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));
      throw new Error(errorMessage);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY),
        SecureStore.deleteItemAsync(USER_STORAGE_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      ]);
    } catch (e) {
      console.error('Error clearing stored auth:', e);
    }

    setState({
      user: null,
      token: null,
      loading: false,
      error: null,
    });
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!state.token) return null;

    // Try to refresh if we have a refresh token
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        const newToken = await refreshIdToken(refreshToken);
        await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, newToken);
        setState(prev => ({ ...prev, token: newToken }));
        return newToken;
      }
    } catch (e) {
      console.warn('Token refresh failed, using existing token:', e);
    }

    return state.token;
  }, [state.token]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signIn,
        signOut,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
