/**
 * Answer Animation Presets
 *
 * This file contains the default CSS animations for Q&A answer card transitions.
 * These are seeded to Firestore via /api/soundEffects/seed
 */

import type { AnswerAnimation } from './types';

/**
 * Base configuration for exit animations.
 * These animate non-selected answer cards off the screen.
 */
const exitAnimationDefaults = {
  type: 'exit' as const,
  durationMs: 500,
  easing: 'ease-out',
  isActive: true,
};

/**
 * Default animation presets for answer cards.
 * 10 exit animations + 1 selection animation.
 */
export const ANSWER_ANIMATION_PRESETS: Omit<AnswerAnimation, 'createdAt' | 'updatedAt'>[] = [
  // ============================================================================
  // EXIT ANIMATIONS (for non-selected answer cards)
  // ============================================================================

  {
    id: 'exit-slide-left',
    name: 'Slide Left',
    ...exitAnimationDefaults,
    order: 1,
    cssAnimationName: 'exitSlideLeft',
    cssKeyframes: `@keyframes exitSlideLeft {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-120%); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'quick whoosh sound swooping left, cartoon style',
      durationSeconds: 0.5,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-slide-right',
    name: 'Slide Right',
    ...exitAnimationDefaults,
    order: 2,
    cssAnimationName: 'exitSlideRight',
    cssKeyframes: `@keyframes exitSlideRight {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(120%); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'quick whoosh sound swooping right, cartoon style',
      durationSeconds: 0.5,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-slide-up',
    name: 'Slide Up',
    ...exitAnimationDefaults,
    order: 3,
    cssAnimationName: 'exitSlideUp',
    cssKeyframes: `@keyframes exitSlideUp {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(-120%); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'rising whoosh sound going upward, playful',
      durationSeconds: 0.5,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-slide-down',
    name: 'Slide Down',
    ...exitAnimationDefaults,
    order: 4,
    cssAnimationName: 'exitSlideDown',
    cssKeyframes: `@keyframes exitSlideDown {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(120%); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'falling whoosh sound going downward, cartoon drop',
      durationSeconds: 0.5,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-shrink',
    name: 'Shrink & Fade',
    ...exitAnimationDefaults,
    order: 5,
    durationMs: 400,
    cssAnimationName: 'exitShrink',
    cssKeyframes: `@keyframes exitShrink {
  from { transform: scale(1); opacity: 1; }
  to { transform: scale(0); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'magical shrinking sound, tiny poof',
      durationSeconds: 0.4,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-spin',
    name: 'Spin Away',
    ...exitAnimationDefaults,
    order: 6,
    durationMs: 600,
    cssAnimationName: 'exitSpin',
    cssKeyframes: `@keyframes exitSpin {
  from { transform: rotate(0deg) scale(1); opacity: 1; }
  to { transform: rotate(360deg) scale(0); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'spinning whirl sound, playful tornado whoosh',
      durationSeconds: 0.6,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-bounce',
    name: 'Bounce Out',
    ...exitAnimationDefaults,
    order: 7,
    durationMs: 500,
    easing: 'ease-in',
    cssAnimationName: 'exitBounce',
    cssKeyframes: `@keyframes exitBounce {
  0% { transform: scale(1); opacity: 1; }
  20% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'bouncy boing sound then pop, cartoon spring',
      durationSeconds: 0.5,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-float',
    name: 'Float Away',
    ...exitAnimationDefaults,
    order: 8,
    durationMs: 700,
    easing: 'ease-in-out',
    cssAnimationName: 'exitFloat',
    cssKeyframes: `@keyframes exitFloat {
  from { transform: translateY(0) rotate(0deg); opacity: 1; }
  to { transform: translateY(-200%) rotate(15deg); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'gentle floating away sound, dreamy ascending',
      durationSeconds: 0.7,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-explode',
    name: 'Explode',
    ...exitAnimationDefaults,
    order: 9,
    durationMs: 400,
    cssAnimationName: 'exitExplode',
    cssKeyframes: `@keyframes exitExplode {
  0% { transform: scale(1); opacity: 1; filter: blur(0px); }
  50% { transform: scale(1.2); opacity: 0.8; filter: blur(2px); }
  100% { transform: scale(0); opacity: 0; filter: blur(10px); }
}`,
    soundEffect: {
      prompt: 'soft magical poof explosion, sparkle burst',
      durationSeconds: 0.4,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  {
    id: 'exit-fade',
    name: 'Fade Out',
    ...exitAnimationDefaults,
    order: 10,
    durationMs: 400,
    cssAnimationName: 'exitFade',
    cssKeyframes: `@keyframes exitFade {
  from { opacity: 1; }
  to { opacity: 0; }
}`,
    soundEffect: {
      prompt: 'gentle fade away sound, soft dissolve',
      durationSeconds: 0.4,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },

  // ============================================================================
  // SELECTION ANIMATION (for the chosen answer)
  // ============================================================================

  {
    id: 'selection-celebrate',
    name: 'Celebrate & Exit',
    type: 'selection',
    order: 1,
    durationMs: 1000,
    easing: 'ease-in-out',
    isActive: true,
    cssAnimationName: 'selectionCelebrate',
    cssKeyframes: `@keyframes selectionCelebrate {
  0% { transform: scale(1) translateX(0); opacity: 1; }
  15% { transform: scale(1.15) translateX(0); opacity: 1; }
  30% { transform: scale(1.1) translateX(0) rotate(-3deg); opacity: 1; }
  45% { transform: scale(1.1) translateX(0) rotate(3deg); opacity: 1; }
  60% { transform: scale(1.1) translateX(0) rotate(0deg); opacity: 1; }
  100% { transform: scale(1) translateX(150%); opacity: 0; }
}`,
    soundEffect: {
      prompt: 'triumphant chime then swoosh away, happy celebration jingle followed by whoosh',
      durationSeconds: 1.0,
      promptInfluence: 0.3,
      generation: { status: 'idle' },
    },
  },
];

/**
 * Get a random exit animation from the presets.
 */
export function getRandomExitAnimation(): typeof ANSWER_ANIMATION_PRESETS[number] {
  const exitAnimations = ANSWER_ANIMATION_PRESETS.filter(a => a.type === 'exit');
  return exitAnimations[Math.floor(Math.random() * exitAnimations.length)];
}

/**
 * Get the selection animation preset.
 */
export function getSelectionAnimation(): typeof ANSWER_ANIMATION_PRESETS[number] | undefined {
  return ANSWER_ANIMATION_PRESETS.find(a => a.type === 'selection');
}
