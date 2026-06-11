/**
 * Shared constants for the emulator-backed E2E environment.
 *
 * Everything is overridable via env so CI can relocate ports, but the defaults
 * match firebase.json and the playwright.config webServer commands.
 *
 * The project id deliberately uses the `demo-` prefix: the Firebase emulators
 * treat demo-* projects as fully offline (no production credentials are ever
 * exchanged), which makes it impossible for a misconfigured run to touch prod.
 */
export const E2E_PROJECT_ID =
  process.env.E2E_FIREBASE_PROJECT_ID || 'demo-storypic-e2e';

export const EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';

export const AUTH_EMULATOR_PORT = Number(
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT || 9099,
);
export const FIRESTORE_EMULATOR_PORT = Number(
  process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080,
);

export const AUTH_EMULATOR_URL = `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`;
export const FIRESTORE_EMULATOR_HOST_PORT = `${EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}`;

/** Marker stamped on every seeded doc, mirroring scripts/cleanup-regression-data.mjs. */
export const REGRESSION_FIELD = 'regressionTest';

/** All seeded/spec-created accounts use this email prefix so cleanup can target them. */
export const E2E_EMAIL_PREFIX = 'e2e-';
export const E2E_EMAIL_DOMAIN = 'example.com';
export const E2E_PASSWORD = 'e2e-Password!234';
export const E2E_PIN = '4275';

/** Build a unique, obviously-synthetic account email for one test run. */
export function uniqueEmail(tag: string): string {
  const slug = tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${E2E_EMAIL_PREFIX}${slug}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${E2E_EMAIL_DOMAIN}`;
}
