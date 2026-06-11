import { describe, expect, it } from 'vitest';

import {
  FLAG_DEFAULTS,
  FEATURE_FLAG_KEYS,
  flagEnvVarName,
  parseFlagEnvValue,
  resolveFlagValue,
} from '../feature-flags';
import {
  getAllFeatureFlags,
  getFeatureFlag,
  type FeatureFlagDeps,
} from '../feature-flags.server';

const KEY = 'health_verbose' as const;
const ENV_VAR = flagEnvVarName(KEY); // FLAG_HEALTH_VERBOSE

describe('flag registry', () => {
  it('health_verbose is registered with default true (worked example)', () => {
    expect(FLAG_DEFAULTS.health_verbose).toBe(true);
    expect(FEATURE_FLAG_KEYS).toContain('health_verbose');
  });

  it('flagEnvVarName uppercases with FLAG_ prefix', () => {
    expect(flagEnvVarName('health_verbose')).toBe('FLAG_HEALTH_VERBOSE');
  });
});

describe('parseFlagEnvValue', () => {
  it('parses true/false case-insensitively with whitespace', () => {
    expect(parseFlagEnvValue('true')).toBe(true);
    expect(parseFlagEnvValue('  TRUE ')).toBe(true);
    expect(parseFlagEnvValue('false')).toBe(false);
    expect(parseFlagEnvValue('False')).toBe(false);
  });

  it('treats unset and garbage values as undefined (no silent flips)', () => {
    expect(parseFlagEnvValue(undefined)).toBeUndefined();
    expect(parseFlagEnvValue('')).toBeUndefined();
    expect(parseFlagEnvValue('1')).toBeUndefined();
    expect(parseFlagEnvValue('yes')).toBeUndefined();
  });
});

describe('resolveFlagValue precedence', () => {
  it('falls back to the in-code default when no source has a value', () => {
    expect(resolveFlagValue({ defaultValue: true })).toEqual({ value: true, source: 'default' });
    expect(resolveFlagValue({ defaultValue: false })).toEqual({ value: false, source: 'default' });
  });

  it('systemConfig beats default', () => {
    expect(resolveFlagValue({ firestoreValue: false, defaultValue: true })).toEqual({
      value: false,
      source: 'systemConfig',
    });
  });

  it('remoteConfig beats systemConfig and default', () => {
    expect(
      resolveFlagValue({ remoteValue: true, firestoreValue: false, defaultValue: false }),
    ).toEqual({ value: true, source: 'remoteConfig' });
  });

  it('env override beats everything', () => {
    expect(
      resolveFlagValue({
        envValue: false,
        remoteValue: true,
        firestoreValue: true,
        defaultValue: true,
      }),
    ).toEqual({ value: false, source: 'env' });
  });

  it('an explicit false from a source is honoured (not treated as unset)', () => {
    expect(resolveFlagValue({ remoteValue: false, defaultValue: true }).value).toBe(false);
  });
});

function deps(overrides: Partial<FeatureFlagDeps> = {}): FeatureFlagDeps {
  return {
    // Empty env by default so the real process.env cannot leak into tests.
    env: {},
    fetchRemoteValues: async () => ({}),
    fetchSystemConfigValues: async () => ({}),
    ...overrides,
  };
}

describe('getFeatureFlag / getAllFeatureFlags (server wiring)', () => {
  it('returns the in-code default when all sources are empty', async () => {
    await expect(getFeatureFlag(KEY, {}, deps())).resolves.toBe(true);
  });

  it('uses the systemConfig fallback when Remote Config has no value', async () => {
    const value = await getFeatureFlag(
      KEY,
      {},
      deps({ fetchSystemConfigValues: async () => ({ [KEY]: false }) }),
    );
    expect(value).toBe(false);
  });

  it('prefers Remote Config over systemConfig', async () => {
    const all = await getAllFeatureFlags(
      {},
      deps({
        fetchRemoteValues: async () => ({ [KEY]: true }),
        fetchSystemConfigValues: async () => ({ [KEY]: false }),
      }),
    );
    expect(all[KEY]).toEqual({ value: true, source: 'remoteConfig' });
  });

  it('env override wins over both fetched sources', async () => {
    const all = await getAllFeatureFlags(
      {},
      deps({
        env: { [ENV_VAR]: 'false' },
        fetchRemoteValues: async () => ({ [KEY]: true }),
        fetchSystemConfigValues: async () => ({ [KEY]: true }),
      }),
    );
    expect(all[KEY]).toEqual({ value: false, source: 'env' });
  });

  it('a throwing Remote Config source falls through to systemConfig', async () => {
    const value = await getFeatureFlag(
      KEY,
      {},
      deps({
        fetchRemoteValues: async () => {
          throw new Error('remote config unreachable');
        },
        fetchSystemConfigValues: async () => ({ [KEY]: false }),
      }),
    );
    expect(value).toBe(false);
  });

  it('all sources throwing still resolves to the in-code default (fail open)', async () => {
    const value = await getFeatureFlag(
      KEY,
      {},
      deps({
        fetchRemoteValues: async () => {
          throw new Error('boom');
        },
        fetchSystemConfigValues: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(value).toBe(FLAG_DEFAULTS[KEY]);
  });

  it('forwards the evaluation context to the Remote Config source', async () => {
    let seenCtx: unknown;
    await getFeatureFlag(
      KEY,
      { uid: 'user-1', email: 'kid@example.com' },
      deps({
        fetchRemoteValues: async (ctx) => {
          seenCtx = ctx;
          return {};
        },
      }),
    );
    expect(seenCtx).toEqual({ uid: 'user-1', email: 'kid@example.com' });
  });

  it('getAllFeatureFlags returns an entry for every registered flag', async () => {
    const all = await getAllFeatureFlags({}, deps());
    expect(Object.keys(all).sort()).toEqual([...FEATURE_FLAG_KEYS].sort());
  });
});
