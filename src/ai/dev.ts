import { config } from 'dotenv';
config();

import '@/ai/flows/story-chat-flow.ts';
import '@/ai/flows/warmup-reply-flow.ts';
import '@/ai/flows/story-beat-flow.ts';
import '@/ai/flows/character-traits-flow.ts';
import '@/ai/flows/story-arc-flow.ts';
import '@/ai/flows/ending-flow.ts';
