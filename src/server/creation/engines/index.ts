/**
 * One engine per surviving mode (creation.md, ADR-0009). Adding a mode means
 * one engine here and one config document; no new routes.
 */
import type { CreationModeId } from '../../data/schemas/story';
import type { CreationModeEngine, EngineDeps } from '../engine';
import { createAdventureEngine, type AdventureCatalog } from './adventure';
import { createFreeplayEngine } from './freeplay';
import { createFriendsEngine } from './friends';
import { createGuidedEngine } from './guided';
import { createWizardEngine } from './wizard';

export type EngineSetDeps = EngineDeps & { storyTypes: AdventureCatalog };

export function createEngines(deps: EngineSetDeps): Record<CreationModeId, CreationModeEngine> {
  return {
    wizard: createWizardEngine(deps),
    freeplay: createFreeplayEngine(deps),
    guided: createGuidedEngine(deps),
    friends: createFriendsEngine(deps),
    adventure: createAdventureEngine(deps),
  };
}

export type { AdventureCatalog };
