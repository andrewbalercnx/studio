import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from './AuthContext';
import { useApiClient } from './ApiClientContext';

interface ChildProfile {
  id: string;
  displayName: string;
  avatarUrl?: string;
  dateOfBirth?: string;
  autoReadAloud?: boolean;
}

interface ChildContextType {
  childId: string | null;
  childProfile: ChildProfile | null;
  children: ChildProfile[];
  loading: boolean;
  requiresPin: boolean;
  setChild: (childId: string) => Promise<void>;
  clearChild: () => Promise<void>;
  verifyPinAndSwitch: (pin: string, newChildId: string) => Promise<boolean>;
  refreshChildren: () => Promise<void>;
}

const ChildContext = createContext<ChildContextType | null>(null);

const CHILD_ID_STORAGE_KEY = 'storypic_selected_child';

export function ChildProvider({ children: childrenProp }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const apiClient = useApiClient();

  const [childId, setChildIdState] = useState<string | null>(null);
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [childrenList, setChildrenList] = useState<ChildProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [requiresPin, setRequiresPin] = useState(false);

  // Load stored child ID and fetch children list when user is authenticated
  useEffect(() => {
    if (authLoading) return;

    if (user) {
      loadChildData();
    } else {
      // Clear child data when logged out
      setChildIdState(null);
      setChildProfile(null);
      setChildrenList([]);
      setLoading(false);
    }
  }, [user, authLoading]);

  const loadChildData = async () => {
    setLoading(true);
    try {
      // Fetch children list
      const children = await apiClient.getChildren();
      setChildrenList(children);

      // Load stored child ID
      const storedChildId = await SecureStore.getItemAsync(CHILD_ID_STORAGE_KEY);

      if (storedChildId) {
        // Verify the stored child still exists and belongs to this user
        const validChild = children.find((c: ChildProfile) => c.id === storedChildId);
        if (validChild) {
          setChildIdState(storedChildId);
          setChildProfile(validChild);
        } else {
          // Stored child no longer valid, clear it
          await SecureStore.deleteItemAsync(CHILD_ID_STORAGE_KEY);
        }
      }
    } catch (e) {
      console.error('Error loading child data:', e);
    } finally {
      setLoading(false);
    }
  };

  const refreshChildren = useCallback(async () => {
    if (!user) return;
    try {
      const children = await apiClient.getChildren();
      setChildrenList(children);

      // Update current child profile if it exists
      if (childId) {
        const updatedProfile = children.find((c: ChildProfile) => c.id === childId);
        if (updatedProfile) {
          setChildProfile(updatedProfile);
        }
      }
    } catch (e) {
      console.error('Error refreshing children:', e);
    }
  }, [user, childId, apiClient]);

  const setChild = useCallback(async (newChildId: string) => {
    // If already have a child selected, require PIN
    if (childId && childId !== newChildId) {
      setRequiresPin(true);
      return;
    }

    try {
      await SecureStore.setItemAsync(CHILD_ID_STORAGE_KEY, newChildId);
      setChildIdState(newChildId);

      // Find the profile in the list
      const profile = childrenList.find(c => c.id === newChildId);
      if (profile) {
        setChildProfile(profile);
      } else {
        // Fetch if not in list
        const fetchedProfile = await apiClient.getChild(newChildId);
        setChildProfile(fetchedProfile);
      }
    } catch (e) {
      console.error('Error setting child:', e);
      throw e;
    }
  }, [childId, childrenList, apiClient]);

  const clearChild = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(CHILD_ID_STORAGE_KEY);
      setChildIdState(null);
      setChildProfile(null);
      setRequiresPin(false);
    } catch (e) {
      console.error('Error clearing child:', e);
    }
  }, []);

  const verifyPinAndSwitch = useCallback(async (pin: string, newChildId: string): Promise<boolean> => {
    try {
      const result = await apiClient.verifyPin(pin);
      if (result.valid) {
        setRequiresPin(false);
        await SecureStore.setItemAsync(CHILD_ID_STORAGE_KEY, newChildId);
        setChildIdState(newChildId);

        const profile = childrenList.find(c => c.id === newChildId);
        if (profile) {
          setChildProfile(profile);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error('Error verifying PIN:', e);
      return false;
    }
  }, [childrenList, apiClient]);

  return (
    <ChildContext.Provider
      value={{
        childId,
        childProfile,
        children: childrenList,
        loading,
        requiresPin,
        setChild,
        clearChild,
        verifyPinAndSwitch,
        refreshChildren,
      }}
    >
      {childrenProp}
    </ChildContext.Provider>
  );
}

export function useChild() {
  const context = useContext(ChildContext);
  if (!context) {
    throw new Error('useChild must be used within a ChildProvider');
  }
  return context;
}
