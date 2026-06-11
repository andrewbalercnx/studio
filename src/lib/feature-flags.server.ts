/**
 * Feature flags — server-side evaluation.
 *
 * Evaluates flags with the precedence defined in `feature-flags.ts`:
 *   env override → Firebase Remote Config (server template) → Firestore
 *   `systemConfig/featureFlags` → in-code default.
 *
 * Design (mirrors `ai-circuit-breaker.server.ts` / `ai-model-config.ts`):
 * - Short-TTL in-memory caches so the hot path costs at most one Remote
 *   Config template fetch + one Firestore read per instance per TTL window.
 * - Every external dependency is injectable for unit tests; the default
 *   implementations lazy-import firebase-admin so tests never touch it.
 * - Failures NEVER throw to callers: a source that errors resolves to
 *   `undefined` and resolution falls through to the next source, ending at
 *   the in-code default. A flag read must not be able to take a request down.
 *
 * Remote Config conditions (configured in the Firebase console, not here):
 * - Percentage rollouts use `randomizationId`, which we set to the user's
 *   UID — anonymous requests have no randomization id, so percentage
 *   conditions resolve false for them (deterministic, documented).
 * - UID allowlists / email-domain targeting use the custom signals `uid`
 *   and `emailDomain` that we pass in the evaluation context.
 * See docs/DEPLOYMENT.md "Feature flags" for copy-pasteable patterns.
 */

import {
  FLAG_DEFAULTS,
  FEATURE_FLAG_KEYS,
  flagEnvVarName,
  parseFlagEnvValue,
  resolveFlagValue,
  type FeatureFlagKey,
  type FlagContext,
  type ResolvedFlag,
} from './feature-flags';

/** Partial map of flag values from one source; `undefined` = source has no
 *  explicit value for that flag. */
export type FlagValues = Partial<Record<FeatureFlagKey, boolean>>;

export type FeatureFlagDeps = {
  /** Returns flags explicitly set in Remote Config for this context. */
  fetchRemoteValues?: (ctx: FlagContext) => Promise<FlagValues>;
  /** Returns flags set on the `systemConfig/featureFlags` Firestore doc. */
  fetchSystemConfigValues?: () => Promise<FlagValues>;
  /** Env source (defaults to process.env). */
  env?: Record<string, string | undefined>;
};

export const FEATURE_FLAGS_DOC_PATH = 'systemConfig/featureFlags';

// ---------------------------------------------------------------------------
// Default Remote Config source (firebase-admin server template, cached).
// ---------------------------------------------------------------------------

const TEMPLATE_CACHE_TTL_MS = 60_000;

type CachedTemplate = {
  // ServerTemplate from firebase-admin/remote-config; typed loosely so this
  // module stays importable in tests without firebase-admin installed types.
  template: { evaluate: (context?: Record<string, string | number>) => RemoteEvaluated } | null;
  fetchedAtMs: number;
};

type RemoteEvaluated = {
  getValue: (key: string) => { getSource: () => string; asBoolean: () => boolean };
};

let templateCache: CachedTemplate | null = null;

async function defaultFetchRemoteValues(ctx: FlagContext): Promise<FlagValues> {
  const now = Date.now();
  if (!templateCache || now - templateCache.fetchedAtMs > TEMPLATE_CACHE_TTL_MS) {
    const { initFirebaseAdminApp } = await import('@/firebase/admin/app');
    const { getRemoteConfig } = await import('firebase-admin/remote-config');
    const app = await initFirebaseAdminApp();
    // getServerTemplate fetches the current template from the Remote Config
    // backend; evaluate() afterwards is purely local and cheap.
    const template = await getRemoteConfig(app).getServerTemplate({
      defaultConfig: FLAG_DEFAULTS,
    });
    templateCache = { template, fetchedAtMs: now };
  }
  if (!templateCache.template) return {};

  const context: Record<string, string | number> = {};
  if (ctx.uid) {
    context.randomizationId = ctx.uid; // drives percentage conditions
    context.uid = ctx.uid; // custom signal for allowlists
  }
  if (ctx.email && ctx.email.includes('@')) {
    context.emailDomain = ctx.email.split('@').pop() as string;
  }

  const evaluated = templateCache.template.evaluate(context);
  const values: FlagValues = {};
  for (const key of FEATURE_FLAG_KEYS) {
    const value = evaluated.getValue(key);
    // Only values actually set in the remote template count — the in-template
    // defaultConfig we pass above reports source 'default' and must fall
    // through to the systemConfig/in-code layers.
    if (value.getSource() === 'remote') {
      values[key] = value.asBoolean();
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// Default Firestore fallback source (systemConfig/featureFlags, cached).
// ---------------------------------------------------------------------------

const SYSTEM_CONFIG_CACHE_TTL_MS = 30_000;

let systemConfigCache: { values: FlagValues; fetchedAtMs: number } | null = null;

async function defaultFetchSystemConfigValues(): Promise<FlagValues> {
  const now = Date.now();
  if (systemConfigCache && now - systemConfigCache.fetchedAtMs <= SYSTEM_CONFIG_CACHE_TTL_MS) {
    return systemConfigCache.values;
  }
  const { getServerFirestore } = await import('./server-firestore');
  const db = await getServerFirestore();
  const snapshot = await db.doc(FEATURE_FLAGS_DOC_PATH).get();
  const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
  const values: FlagValues = {};
  for (const key of FEATURE_FLAG_KEYS) {
    const raw = (data as Record<string, unknown>)[key];
    if (typeof raw === 'boolean') values[key] = raw;
  }
  systemConfigCache = { values, fetchedAtMs: now };
  return values;
}

/** Test hook: clears module-level caches. */
export function clearFeatureFlagCaches(): void {
  templateCache = null;
  systemConfigCache = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function safeFetch(
  label: string,
  fetcher: () => Promise<FlagValues>,
): Promise<FlagValues> {
  try {
    return await fetcher();
  } catch (error) {
    console.warn(`[feature-flags] ${label} source failed; falling through:`, error);
    return {};
  }
}

/** Resolve every registered flag for a context. */
export async function getAllFeatureFlags(
  ctx: FlagContext = {},
  deps: FeatureFlagDeps = {},
): Promise<Record<FeatureFlagKey, ResolvedFlag>> {
  const env = deps.env ?? process.env;
  const fetchRemote = deps.fetchRemoteValues ?? defaultFetchRemoteValues;
  const fetchSystemConfig = deps.fetchSystemConfigValues ?? defaultFetchSystemConfigValues;

  const [remoteValues, firestoreValues] = await Promise.all([
    safeFetch('remoteConfig', () => fetchRemote(ctx)),
    safeFetch('systemConfig', () => fetchSystemConfig()),
  ]);

  const resolved = {} as Record<FeatureFlagKey, ResolvedFlag>;
  for (const key of FEATURE_FLAG_KEYS) {
    resolved[key] = resolveFlagValue({
      envValue: parseFlagEnvValue(env[flagEnvVarName(key)]),
      remoteValue: remoteValues[key],
      firestoreValue: firestoreValues[key],
      defaultValue: FLAG_DEFAULTS[key],
    });
  }
  return resolved;
}

/** Resolve a single flag (boolean only — most call sites). */
export async function getFeatureFlag(
  key: FeatureFlagKey,
  ctx: FlagContext = {},
  deps: FeatureFlagDeps = {},
): Promise<boolean> {
  const all = await getAllFeatureFlags(ctx, deps);
  return all[key].value;
}
