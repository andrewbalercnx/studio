'use client';

/**
 * API Client Context
 *
 * Provides a typed API client to child-facing components.
 * This client wraps the REST API calls with proper authentication.
 */

import { createContext, useContext, useMemo } from 'react';
import { StoryPicClient } from '@storypic/api-client';
import { useUser } from '@/firebase/auth/use-user';

type ApiClientContextValue = StoryPicClient | null;

const ApiClientContext = createContext<ApiClientContextValue>(null);

export type ApiClientProviderProps = {
  children: React.ReactNode;
  /** Optional base URL override (default: '/api') */
  baseUrl?: string;
};

/**
 * Provider that creates and manages the API client instance.
 * Must be used within a FirebaseClientProvider.
 */
export function ApiClientProvider({
  children,
  baseUrl = '/api',
}: ApiClientProviderProps) {
  const { user } = useUser();

  const client = useMemo(() => {
    if (!user) return null;

    return new StoryPicClient({
      baseUrl,
      getToken: async () => {
        const token = await user.getIdToken();
        return token;
      },
      timeout: 120000, // 2 minutes for long-running AI operations
    });
  }, [user, baseUrl]);

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

/**
 * Hook to get the API client.
 * Returns null if user is not authenticated.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const client = useApiClient();
 *
 *   const handleClick = async () => {
 *     if (!client) return;
 *     const generators = await client.getGenerators();
 *     // ...
 *   };
 * }
 * ```
 */
export function useApiClient(): StoryPicClient | null {
  return useContext(ApiClientContext);
}

/**
 * Hook to get the API client, throwing if not available.
 * Use this when you know the user is authenticated.
 *
 * @throws Error if client is not available
 *
 * @example
 * ```tsx
 * function AuthenticatedComponent() {
 *   const client = useRequiredApiClient();
 *   // client is guaranteed to be non-null here
 *   const generators = await client.getGenerators();
 * }
 * ```
 */
export function useRequiredApiClient(): StoryPicClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error(
      'useRequiredApiClient must be used within an ApiClientProvider with an authenticated user'
    );
  }
  return client;
}
