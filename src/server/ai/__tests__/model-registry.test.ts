import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../../testing/fake-firestore';
import { ConfigService } from '../../config/config-service';
import { AIModelRegistry, AI_PURPOSES, DEFAULT_AI_MODELS, aiModelsConfig } from '../model-registry';

function registryWith(doc?: Record<string, unknown>) {
  const fake = new FakeFirestore();
  if (doc) fake.store.set('config/aiModels', doc);
  const config = new ConfigService({ db: fake.asFirestore() });
  return { registry: new AIModelRegistry(config), fake, config };
}

describe('AIModelRegistry', () => {
  it('falls back to code defaults for every purpose', async () => {
    const { registry } = registryWith();
    for (const purpose of AI_PURPOSES) {
      await expect(registry.resolve(purpose)).resolves.toMatchObject({ purpose, model: DEFAULT_AI_MODELS[purpose], source: 'default' });
    }
    expect(DEFAULT_AI_MODELS['creation.text']).toBe('googleai/gemini-2.5-pro');
    expect(DEFAULT_AI_MODELS['book.pageArt']).toBe('googleai/gemini-2.5-flash-image');
  });

  it('uses config/aiModels where set', async () => {
    const { registry } = registryWith({ purposes: { 'book.pageArt': 'googleai/gemini-3-pro-image' } });
    await expect(registry.resolve('book.pageArt')).resolves.toEqual({
      purpose: 'book.pageArt',
      model: 'googleai/gemini-3-pro-image',
      kind: 'image',
      source: 'config',
    });
    await expect(registry.resolve('book.castSheet')).resolves.toMatchObject({ source: 'default' });
  });

  it('lets a CreationMode override creation.text only', async () => {
    const { registry } = registryWith({ purposes: { 'creation.text': 'googleai/gemini-2.5-flash' } });
    await expect(registry.resolve('creation.text', { creationModeModel: 'googleai/mode-model' })).resolves.toMatchObject({
      model: 'googleai/mode-model',
      source: 'creationMode',
    });
    await expect(registry.resolve('manuscript.text', { creationModeModel: 'googleai/mode-model' })).rejects.toThrow(
      /creation\.text only/
    );
  });

  it('picks up config changes after invalidation', async () => {
    const { registry, fake, config } = registryWith();
    await expect(registry.resolve('narration')).resolves.toMatchObject({ model: 'elevenlabs/eleven_v3' });
    fake.store.set('config/aiModels', { purposes: { narration: 'elevenlabs/eleven_multilingual_v2' } });
    config.invalidate(aiModelsConfig);
    await expect(registry.resolve('narration')).resolves.toMatchObject({ model: 'elevenlabs/eleven_multilingual_v2' });
  });
});
