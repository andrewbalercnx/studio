import {genkit} from 'genkit';
import {genkit as genkitBeta} from 'genkit/beta';
import {googleAI} from '@genkit-ai/google-genai';
import {vertexAI} from '@genkit-ai/vertexai';

// Get GCP project and location from environment
const gcpProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
const gcpLocation = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

export const ai = genkit({
  plugins: [
    googleAI(),
    // Add Vertex AI plugin for Veo video generation and other Vertex-specific models
    ...(gcpProject ? [vertexAI({ projectId: gcpProject, location: gcpLocation })] : []),
  ],
  model: 'googleai/gemini-2.5-pro',
});

// Beta API instance for chat functionality
export const aiBeta = genkitBeta({
  plugins: [
    googleAI(),
    ...(gcpProject ? [vertexAI({ projectId: gcpProject, location: gcpLocation })] : []),
  ],
  model: 'googleai/gemini-2.5-pro',
});
