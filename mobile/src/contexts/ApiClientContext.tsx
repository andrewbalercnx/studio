import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useAuth } from './AuthContext';

// API base URL - use your deployed backend
const API_BASE_URL = 'https://storypic.rcnx.io';

// Simplified API client for mobile
// This mirrors the @storypic/api-client but is self-contained for the mobile app
class MobileApiClient {
  private baseUrl: string;
  private getToken: () => Promise<string | null>;

  constructor(config: { baseUrl: string; getToken: () => Promise<string | null> }) {
    this.baseUrl = config.baseUrl;
    this.getToken = config.getToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || `HTTP ${response.status}`;
      } catch {
        errorMessage = errorText || `HTTP ${response.status}`;
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  // ============================================
  // Discovery (public endpoints)
  // ============================================

  async getGenerators(): Promise<any[]> {
    const response = await this.request<{ ok: boolean; generators: any[] }>('/api/kids-generators');
    return response.generators || [];
  }

  async getOutputTypes(): Promise<any[]> {
    const response = await this.request<{ ok: boolean; outputTypes: any[] }>('/api/storyOutputTypes');
    return response.outputTypes || [];
  }

  async getImageStyles(): Promise<any[]> {
    const response = await this.request<{ ok: boolean; imageStyles: any[] }>('/api/imageStyles');
    return response.imageStyles || [];
  }

  // ============================================
  // Child data
  // ============================================

  async getChildren(): Promise<any[]> {
    return this.request('/api/children');
  }

  async getChild(childId: string): Promise<any> {
    return this.request(`/api/children/${childId}`);
  }

  async getMyStories(childId: string): Promise<any[]> {
    return this.request(`/api/stories?childId=${childId}`);
  }

  async getStory(storyId: string): Promise<any> {
    return this.request(`/api/stories/${storyId}`);
  }

  async getMyStorybooks(storyId: string): Promise<any[]> {
    return this.request(`/api/stories/${storyId}/storybooks`);
  }

  // ============================================
  // Story creation
  // ============================================

  async createSession(childId: string, generatorId: string): Promise<any> {
    return this.request('/api/storySession', {
      method: 'POST',
      body: JSON.stringify({ childId, generatorId }),
    });
  }

  async sendWizardChoice(
    childId: string,
    sessionId: string,
    answers: Array<{ question: string; answer: string }>
  ): Promise<any> {
    return this.request('/api/storyWizard', {
      method: 'POST',
      body: JSON.stringify({ childId, sessionId, answers }),
    });
  }

  async sendBeatChoice(sessionId: string, optionId: string): Promise<any> {
    return this.request('/api/storyBeat', {
      method: 'POST',
      body: JSON.stringify({ sessionId, optionId }),
    });
  }

  async sendFriendsAction(sessionId: string, action: string, data?: any): Promise<any> {
    return this.request('/api/storyFriends', {
      method: 'POST',
      body: JSON.stringify({ sessionId, action, ...data }),
    });
  }

  async compileStory(sessionId: string): Promise<any> {
    return this.request('/api/storyCompile', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  // ============================================
  // Storybook generation
  // ============================================

  async createStorybook(
    storyId: string,
    outputTypeId: string,
    styleId: string,
    imageStylePrompt: string
  ): Promise<any> {
    return this.request(`/api/storybookV2/create`, {
      method: 'POST',
      body: JSON.stringify({ storyId, outputTypeId, styleId, imageStylePrompt }),
    });
  }

  async generatePages(storyId: string, storybookId: string): Promise<any> {
    return this.request('/api/storybookV2/pages', {
      method: 'POST',
      body: JSON.stringify({ storyId, storybookId }),
    });
  }

  async generateImages(storyId: string, storybookId: string): Promise<any> {
    return this.request('/api/storybookV2/images', {
      method: 'POST',
      body: JSON.stringify({ storyId, storybookId }),
    });
  }

  async getStorybookPages(storyId: string, storybookId: string): Promise<any[]> {
    return this.request(`/api/stories/${storyId}/storybooks/${storybookId}/pages`);
  }

  // ============================================
  // TTS
  // ============================================

  async speak(text: string, voiceId?: string): Promise<string> {
    const response = await this.request<{ audioUrl: string }>('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text, voiceId }),
    });
    return response.audioUrl;
  }

  // ============================================
  // PIN verification
  // ============================================

  async verifyPin(pin: string): Promise<{ valid: boolean }> {
    return this.request('/api/parent/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  }
}

const ApiClientContext = createContext<MobileApiClient | null>(null);

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  const client = useMemo(
    () =>
      new MobileApiClient({
        baseUrl: API_BASE_URL,
        getToken,
      }),
    [getToken]
  );

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient() {
  const context = useContext(ApiClientContext);
  if (!context) {
    throw new Error('useApiClient must be used within an ApiClientProvider');
  }
  return context;
}
