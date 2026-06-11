/**
 * Feature flags — shared (client + server safe) definitions.
 *
 * The flag REGISTRY and the pure precedence resolver live here so both the
 * server util (`feature-flags.server.ts`) and the client hook
 * (`src/hooks/use-feature-flag.ts`) can import them without dragging
 * firebase-admin into a client bundle.
 *
 * Adding a flag:
 * 1. Add the key + in-code default to `FLAG_DEFAULTS` below.
 * 2. (Optional) Create the parameter in Firebase Remote Config with the same
 *    key and any conditions (UID allowlist / email domain / percentage —
 *    see docs/DEPLOYMENT.md "Feature flags").
 * 3. (Optional) Set a fallback value on the Firestore doc
 *    `systemConfig/featureFlags` (field name = flag key).
 *
 * Precedence (highest wins) — see `resolveFlagValue`:
 *   1. Environment override `FLAG_<KEY_UPPERCASED>` ("true"/"false") — ops
 *      escape hatch; works even when Firestore/Remote Config are down.
 *   2. Firebase Remote Config (only when the parameter is actually set
 *      remotely — in-template defaults do NOT count as a remote value).
 *   3. Firestore `systemConfig/featureFlags` (admin-editable fallback that
 *      works before Remote Config is configured for the project).
 *   4. The in-code default in `FLAG_DEFAULTS`.
 */

/** All known flags and their in-code defaults. Keep keys snake_case to match
 *  Remote Config parameter naming. */
export const FLAG_DEFAULTS = {
  /**
   * Worked example (see docs/DEPLOYMENT.md): when true, GET /api/health
   * returns the full body (uptime, dependency probes). When false it returns
   * the minimal `{ status, version }` body — demonstrates disabling a
   * production behaviour without a deploy, and doubles as a load-shedding
   * switch for the Firestore probe.
   */
  health_verbose: true,
} as const satisfies Record<string, boolean>;

export type FeatureFlagKey = keyof typeof FLAG_DEFAULTS;

export const FEATURE_FLAG_KEYS = Object.keys(FLAG_DEFAULTS) as FeatureFlagKey[];

/** Evaluation context forwarded to Remote Config conditions. */
export type FlagContext = {
  uid?: string;
  email?: string;
};

export type FlagSource = 'env' | 'remoteConfig' | 'systemConfig' | 'default';

export type ResolvedFlag = {
  value: boolean;
  source: FlagSource;
};

/** Env var name for the override of a given flag key. */
export function flagEnvVarName(key: string): string {
  return `FLAG_${key.toUpperCase()}`;
}

/** Parse an env override value; anything other than "true"/"false" (case
 *  insensitive) is treated as unset so a typo cannot silently flip a flag. */
export function parseFlagEnvValue(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const normalised = raw.trim().toLowerCase();
  if (normalised === 'true') return true;
  if (normalised === 'false') return false;
  return undefined;
}

/**
 * Pure precedence resolver. Each source supplies `boolean` when it has an
 * explicit value for the flag and `undefined` when it does not (unset,
 * unreachable, or fetch failed) — failures upstream must map to `undefined`
 * so resolution falls through rather than flipping the flag.
 */
export function resolveFlagValue(input: {
  envValue?: boolean;
  remoteValue?: boolean;
  firestoreValue?: boolean;
  defaultValue: boolean;
}): ResolvedFlag {
  if (input.envValue !== undefined) return { value: input.envValue, source: 'env' };
  if (input.remoteValue !== undefined) return { value: input.remoteValue, source: 'remoteConfig' };
  if (input.firestoreValue !== undefined) return { value: input.firestoreValue, source: 'systemConfig' };
  return { value: input.defaultValue, source: 'default' };
}
