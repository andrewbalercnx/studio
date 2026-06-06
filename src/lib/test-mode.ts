/**
 * TEST_MODE AI seam.
 *
 * A centralised, env-gated switch that lets end-to-end tests (Playwright +
 * Firebase Emulator) drive the storybook generation state machine
 * (`pageGeneration` / `imageGeneration` / `audioGeneration` / `exemplarGeneration`
 * `idle -> running -> ready`) WITHOUT calling Gemini / ElevenLabs / fal.
 *
 * When the flag is unset (the default, including all of production) every helper
 * here is inert: `isTestMode()` returns `false` and the generation routes/flows
 * take their normal path. Nothing in this module touches a network or an LLM.
 *
 * Why a server-side seam (not client `route()` interception): generation runs
 * server-side in `/api/storybookV2/*` and is observed by the client through
 * Firestore status listeners. The only way to make that loop deterministic is to
 * short-circuit on the server and still advance the real Firestore status docs.
 *
 * Activation: set EITHER `TEST_MODE=1` or `E2E_FAKE_AI=1` in the server env.
 * Any value other than '1' / 'true' (case-insensitive) is treated as off.
 */

/** The env var names that activate the seam. First match wins. */
export const TEST_MODE_ENV_VARS = ['TEST_MODE', 'E2E_FAKE_AI'] as const;

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true';
}

/**
 * True when the TEST_MODE AI seam is active. Reads the env on every call so a
 * test harness can toggle it per-process without import-order surprises.
 *
 * An optional `env` argument is accepted purely so the behaviour is unit-testable
 * without mutating `process.env`; production callers pass nothing.
 */
export function isTestMode(
  env: Record<string, string | undefined> = process.env
): boolean {
  return TEST_MODE_ENV_VARS.some((name) => isTruthyFlag(env[name]));
}

/**
 * A 1x1 transparent PNG as a data URL. Used as the deterministic stand-in image
 * for every page so the client renders a real <img> without any network fetch.
 */
export const TEST_MODE_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A short silent WAV as a data URL, the deterministic stand-in for narration. */
export const TEST_MODE_AUDIO_DATA_URL =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/**
 * Deterministic fixture pages for the page-generation step. A title page plus two
 * interior pages — enough to exercise the reader, image and audio loops without
 * any model call. Shapes mirror what `storyPageFlow` returns so the route's
 * downstream write logic is unchanged.
 */
export function buildTestModePages(storyId: string) {
  const title = `Test Story ${storyId}`;
  return [
    {
      pageNumber: 1,
      kind: 'title_page' as const,
      title,
      bodyText: title,
      displayText: title,
      imagePrompt: '',
      entityIds: [] as string[],
    },
    {
      pageNumber: 2,
      kind: 'text' as const,
      bodyText: 'Once upon a test, everything worked deterministically.',
      displayText: 'Once upon a test, everything worked deterministically.',
      imagePrompt: 'A cheerful test illustration of page two.',
      entityIds: [] as string[],
    },
    {
      pageNumber: 3,
      kind: 'text' as const,
      bodyText: 'And the end-to-end suite ran green, the end.',
      displayText: 'And the end-to-end suite ran green, the end.',
      imagePrompt: 'A celebratory test illustration of page three.',
      entityIds: [] as string[],
    },
  ];
}
