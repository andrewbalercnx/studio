import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { createStoryPicClient, StoryPicApiError, type StoryPicClient, type CreationModeView, type StoryTurnView } from '@storypic/api-client';
import { useAuth } from './AuthContext';

// API base URL - use your deployed backend
const API_BASE_URL = 'https://storypic.rcnx.io';

// The app is API-only and uses the same client and types as the web app
// (`@storypic/api-client`, Phase 6.1).
export * from '@storypic/api-client';
/** Older names the screens use. */
export type CreationMode = CreationModeView;
export type StoryTurn = StoryTurnView;
export const ApiError = StoryPicApiError;
export type ApiError = StoryPicApiError;

const ApiClientContext = createContext<StoryPicClient | null>(null);

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  const client = useMemo(() => createStoryPicClient({ baseUrl: `${API_BASE_URL}/api`, getToken }), [getToken]);

  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): StoryPicClient {
  const context = useContext(ApiClientContext);
  if (!context) {
    throw new Error('useApiClient must be used within an ApiClientProvider');
  }
  return context;
}
