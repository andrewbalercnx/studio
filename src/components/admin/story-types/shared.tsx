'use client';
import { Play } from 'lucide-react';
import type { StoryType, StoryTypePromptConfig, ArcStep } from '@/lib/types';

export function formatAgeRange(storyType: StoryType): string {
  const { ageFrom, ageTo, ageRange } = storyType;
  // Support new ageFrom/ageTo fields
  if (ageFrom !== undefined || ageTo !== undefined) {
    if (ageFrom != null && ageTo != null) {
      return `${ageFrom}-${ageTo}`;
    } else if (ageFrom != null) {
      return `${ageFrom}+`;
    } else if (ageTo != null) {
      return `up to ${ageTo}`;
    }
    return 'All ages';
  }
  // Fallback to legacy ageRange
  return ageRange || 'All ages';
}

// Default prompt config for new story types
export const defaultPromptConfig: StoryTypePromptConfig = {
    roleDefinition: "You are a gentle storyteller guiding a young child through a magical adventure. You speak in warm, simple language filled with wonder.",
    behaviorRules: [
        "Always use placeholder IDs ($$id$$) for characters - never include display names",
        "Never introduce scary or threatening elements",
        "Keep sentences short and rhythmic for young listeners",
        "Include sensory details that bring the story to life"
    ],
    narrativeStyle: "Warm and cozy with gentle wonder",
    thematicElements: ["Friendship", "Kindness", "Small adventures"],
    pacing: "moderate",
    emotionalTone: "gentle",
    storyBeatInstructions: "Continue the story with gentle pacing. Each beat should include a small discovery or interaction. End each beat with exactly 3 choices for the child.",
    warmupInstructions: "Engage the child in friendly conversation to understand their mood and preferences.",
    endingInstructions: "Bring the story to a cozy, satisfying conclusion with warmth and contentment.",
    model: {
        name: "googleai/gemini-3.8-flash",
        temperature: 0.7,
        maxOutputTokens: 10000
    }
};

export const sampleStoryTypes: StoryType[] = [
    {
        id: "animal_adventure_v1",
        name: "Animal Adventure",
        shortDescription: "A friendly animal goes on a small adventure to meet a friend or find something special.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["animals", "adventure", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character in their familiar, cozy world. Show their personality through a simple action or thought. Keep it warm and inviting." },
                { id: "explore_setting", label: "Explore Setting", guidance: "The character ventures into or notices something interesting in their environment. Build curiosity and wonder about the natural world around them." },
                { id: "tiny_goal", label: "Tiny Goal", guidance: "The character decides they want to do something small but meaningful - find a friend, get a treat, or explore a new spot. Keep the goal simple and relatable." },
                { id: "tiny_obstacle", label: "Tiny Obstacle", guidance: "A gentle, non-scary challenge appears. This should be solvable with kindness, creativity, or help from a friend. Never anything frightening." },
                { id: "resolution", label: "Resolution", guidance: "The character overcomes the obstacle in a satisfying way, perhaps with help from a new or existing friend. Celebrate the small victory with warmth." },
                { id: "happy_close", label: "Happy Close", guidance: "End on a cozy, content note. The character is safe, happy, and perhaps has learned something or made a friend. Leave the child feeling good." }
            ]
        },
        promptConfig: {
            roleDefinition: "You are a gentle storyteller guiding a young child through a cozy animal adventure. You speak in warm, simple language filled with wonder about the natural world.",
            behaviorRules: [
                "Always use placeholder IDs ($$id$$) for characters - never include display names",
                "Never introduce scary or threatening elements",
                "Keep sentences short and rhythmic for young listeners",
                "Include sensory details about nature - sounds, smells, textures"
            ],
            narrativeStyle: "Warm and cozy with gentle wonder about animals and nature",
            thematicElements: ["Friendship", "Nature appreciation", "Helping others", "Small adventures"],
            pacing: "slow",
            emotionalTone: "gentle",
            storyBeatInstructions: "Continue the animal adventure with gentle pacing. Each beat should include a small discovery or interaction with nature. Animals should be friendly and curious.",
            warmupInstructions: "Ask about the child's favorite animals. Be curious about what animals they might want to meet on an adventure.",
            endingInstructions: "Bring the animal adventure to a cozy conclusion. The animal friend says goodbye with a promise to meet again.",
            model: {
                name: "googleai/gemini-3.8-flash",
                temperature: 0.7,
                maxOutputTokens: 10000
            }
        }
    },
    {
        id: "magical_friend_v1",
        name: "Magical Friend",
        shortDescription: "A gentle magical friend helps with a small problem using kind, sparkly magic.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["magic", "friendship", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character in their everyday world. Establish their personality and hint at something special about to happen." },
                { id: "meet_magical_friend", label: "Meet Magical Friend", guidance: "A gentle, friendly magical being appears - perhaps a fairy, a talking animal, or a kind wizard. They should feel safe and kind, never scary." },
                { id: "discover_small_problem", label: "Discover Small Problem", guidance: "The character notices a small problem that needs solving - a lost toy, a sad friend, or something that needs fixing. Keep it low-stakes and relatable." },
                { id: "gentle_magic_helps", label: "Gentle Magic Helps", guidance: "The magical friend uses kind, sparkly magic to help. Describe the magic as warm, glowing, and gentle. The solution should feel wonderful and safe." },
                { id: "resolution", label: "Resolution", guidance: "The problem is solved! Show the happiness this brings. Perhaps there's a small lesson about friendship or kindness woven in naturally." },
                { id: "happy_close", label: "Happy Close", guidance: "The magical friend says a warm goodbye (perhaps promising to return), and the character feels content and special. End with cozy warmth." }
            ]
        }
    },
    {
        id: "big_feelings_v1",
        name: "Big Feelings",
        shortDescription: "A character notices a big feeling and gently learns about it with help from a friend.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["feelings", "friendship", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character doing something ordinary. Set up a calm, relatable scene before the feeling emerges." },
                { id: "notice_feeling", label: "Notice Feeling", guidance: "The character notices they're experiencing a big feeling - maybe frustration, sadness, worry, or excitement. Describe how the feeling shows up in their body." },
                { id: "talk_with_helper", label: "Talk With Helper", guidance: "A caring helper (parent, friend, stuffed animal) notices and asks about the feeling. They listen without judgment and validate that it's okay to feel this way." },
                { id: "try_small_action", label: "Try Small Action", guidance: "Together, they try something gentle to help with the feeling - taking deep breaths, a hug, talking it through, or doing something calming. Show this helping." },
                { id: "feeling_softens", label: "Feeling Softens", guidance: "The big feeling starts to feel more manageable. It doesn't have to disappear completely, but the character feels better able to handle it." },
                { id: "happy_close", label: "Happy Close", guidance: "End with the character feeling understood and okay. Reinforce that all feelings are valid and that it's good to talk about them." }
            ]
        }
    },
    {
        id: "favorite_place_adventure_v1",
        name: "Adventure in a Favorite Place",
        shortDescription: "A small adventure happens in the child's favorite place, using warmup information.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["place", "exploration", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character excited about going to or being in their favorite place. Build anticipation and show why this place is special to them." },
                { id: "arrive_at_favorite_place", label: "Arrive at Favorite Place", guidance: "Describe arriving at or exploring the favorite place with wonder and joy. Use sensory details - what they see, hear, smell. Make it feel magical and special." },
                { id: "tiny_goal", label: "Tiny Goal", guidance: "The character decides they want to do something fun or find something special in this place. The goal should feel natural to the setting." },
                { id: "tiny_obstacle", label: "Tiny Obstacle", guidance: "A small, gentle challenge arises - maybe they can't find what they're looking for, or need to figure something out. Keep it age-appropriate and non-scary." },
                { id: "resolution", label: "Resolution", guidance: "The character solves the problem, perhaps discovering something even better than expected. Celebrate the joy of the favorite place." },
                { id: "happy_close", label: "Happy Close", guidance: "End with warm feelings about the favorite place. The character feels happy and can't wait to return. Create a sense of comfort and belonging." }
            ]
        }
    },
    {
        id: "silly_story_v1",
        name: "Silly Story",
        shortDescription: "A very silly story with giggles, funny things, and safe, playful surprises.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["silly", "funny", "play"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character in a playful way. Maybe they're already doing something a little silly or unusual. Set a fun, lighthearted tone." },
                { id: "discover_silly_thing", label: "Discover Silly Thing", guidance: "The character discovers something wonderfully silly - a backwards-talking bird, shoes that make funny sounds, food that changes colors. Be creative and playful!" },
                { id: "play_with_silliness", label: "Play With Silliness", guidance: "The character (and maybe friends) play with the silly thing. Include funny sounds, silly actions, and lots of giggle-worthy moments. Keep it joyful and goofy." },
                { id: "tiny_surprise", label: "Tiny Surprise", guidance: "Something unexpectedly funny happens - a playful twist that makes things even sillier. Keep surprises safe and delightful, never scary." },
                { id: "resolution", label: "Resolution", guidance: "The silliness reaches a fun peak, then settles into happy giggles. Maybe everyone joins in the silliness for a big, joyful moment." },
                { id: "happy_close", label: "Happy Close", guidance: "End with everyone happy and maybe still giggling. The silly memory will be treasured. Leave the child smiling and feeling playful." }
            ]
        }
    },
    {
        id: "bedtime_calm_v1",
        name: "Bedtime Calm Story",
        shortDescription: "A soft, sleepy story that ends with everyone cozy and calm.",
        ageFrom: 3,
        ageTo: 5,
        status: "live",
        tags: ["bedtime", "calm", "gentle"],
        defaultPhaseId: "story_beat_phase_v1",
        endingPhaseId: "ending_phase_v1",
        levelBands: ["low", "medium", "high"],
        arcTemplate: {
            steps: [
                { id: "introduce_character", label: "Introduce Character", guidance: "Introduce the main character as evening approaches. Use soft, gentle language. The world is quieting down. Keep the pace slow and soothing." },
                { id: "quiet_activity", label: "Quiet Activity", guidance: "The character does something calm and peaceful - watching stars, having warm milk, gentle play with a stuffed friend. Use sensory details that feel cozy." },
                { id: "soft_change", label: "Soft Change", guidance: "Something gentle happens - perhaps a lullaby is heard, soft lights appear, or a comforting presence arrives. Keep it dreamy and peaceful." },
                { id: "getting_cozy", label: "Getting Cozy", guidance: "The character starts to settle in - finding a cozy spot, cuddling something soft, feeling safe and warm. Describe the comfort in detail." },
                { id: "sleepy_close", label: "Sleepy Close", guidance: "Eyes grow heavy, yawns come naturally. The world feels safe and quiet. Use repetitive, soothing language. Everything is peaceful." },
                { id: "happy_close", label: "Happy Close", guidance: "The character drifts off to happy dreams, surrounded by love and warmth. End with the gentlest, most peaceful feeling possible." }
            ]
        }
    }
];

/**
 * Normalizes arc steps to handle both legacy string format and new ArcStep object format.
 */
export function normalizeArcSteps(steps: (string | ArcStep)[]): ArcStep[] {
  return steps.map(step =>
    typeof step === 'string'
      ? { id: step, label: step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
      : step
  );
}
