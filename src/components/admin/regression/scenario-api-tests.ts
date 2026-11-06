'use client';

import { authFetch } from '@/lib/auth-fetch';
import { collection, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Firestore, DocumentReference } from 'firebase/firestore';
import { api } from '@/lib/api';
import { REGRESSION_SUITE_TAG, addRegressionMeta, cleanupRegressionArtifacts, createArtifactTracker, trackArtifact } from '@/components/admin/regression/shared';
import type { RegressionContext } from './context';

/** Regression scenarios run from the admin regression page. */
export async function runScenarioAndApiTests({ firestore, auth, updateTestResult, setDiagnostics }: RegressionContext): Promise<void> {
  if (!firestore) return;
  
  const artifacts = createArtifactTracker();

  const createRegressionChild = async (data: Record<string, any>, scenarioId: string) => {
      const childRef = await addDoc(collection(firestore, 'children'), addRegressionMeta(data, scenarioId));
      trackArtifact(artifacts, 'children', childRef.id);
      return childRef;
  };

  const createRegressionPrintOrder = async (data: Record<string, any>, scenarioId: string) => {
      const orderRef = await addDoc(collection(firestore, 'printOrders'), addRegressionMeta(data, scenarioId));
      trackArtifact(artifacts, 'printOrders', orderRef.id);
      return orderRef;
  }

  const createRegressionCharacter = async (data: Record<string, any>, scenarioId: string) => {
      const characterRef = await addDoc(collection(firestore, 'characters'), addRegressionMeta(data, scenarioId));
      trackArtifact(artifacts, 'characters', characterRef.id);
      return characterRef;
  };

  const tagExistingDoc = async (docRef: DocumentReference, scenarioId: string) => {
      await updateDoc(docRef, addRegressionMeta({}, scenarioId));
  };

  let apiSummary: any = {};

  try {

  // Test: API_BOOKS_V3_AUTH — the server-side Book pipeline routes (slice 5.1).
  // All five reject anonymous calls (401). Authenticated calls on ids that do
  // not exist get past the auth gate and return 404, so no Manuscript or Book
  // is created, no allowance is charged and no AI runs. The full pipeline is
  // covered by src/server/books/__tests__/pipeline.test.ts (and runs in the
  // emulator with TEST_MODE=1).
  try {
      const booksToken = await auth?.currentUser?.getIdToken?.();
      if (!booksToken) throw new Error('Admin authentication required for books auth test.');
      const missingStory = { storyId: 'regression-missing-story', formId: 'regression-missing-form' };
      const missingBook = 'regression-missing-book';
      // method defaults to POST; authed calls on missing ids return 404 unless
      // `expectAuthed` says otherwise (the Books list returns 200 for any owner).
      const routes: Array<{ path: string; body?: unknown; method?: 'GET' | 'POST'; expectAuthed?: number }> = [
          { path: '/api/manuscripts', body: missingStory },
          { path: '/api/books', body: { ...missingStory, styleId: 'regression-missing-style', idempotencyKey: 'regression-books-auth' } },
          { path: `/api/books/${missingBook}/pages/2/retry` },
          { path: `/api/books/${missingBook}/lock` },
          { path: `/api/books/${missingBook}/unlock` },
          { path: '/api/books', method: 'GET', expectAuthed: 200 },
          { path: `/api/books/${missingBook}`, method: 'GET', expectAuthed: 404 },
          // Print render (slice 5.5a): a missing Book is 404 before any template is read or render started.
          { path: `/api/books/${missingBook}/print-options`, method: 'GET', expectAuthed: 404 },
          { path: `/api/books/${missingBook}/renders`, body: { layoutId: 'regression-missing-layout', idempotencyKey: 'regression-render-auth' } },
          { path: `/api/books/${missingBook}/renders`, method: 'GET', expectAuthed: 404 },
          { path: `/api/books/${missingBook}/renders/regression-missing-render`, method: 'GET', expectAuthed: 404 },
          // Print orders (slice 5.5b): a missing Book or order is 404 before any render, payment or Stripe call.
          {
              path: '/api/orders',
              body: {
                  bookId: missingBook, layoutId: 'regression-missing-layout', quantity: 1, idempotencyKey: 'regression-orders-auth',
                  contactEmail: 'regression@storypic.test',
                  shippingAddress: { name: 'Regression Test', line1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA' },
              },
          },
          { path: '/api/orders', method: 'GET', expectAuthed: 200 },
          { path: '/api/orders/regression-missing-order', method: 'GET', expectAuthed: 404 },
          { path: '/api/orders/regression-missing-order/checkout' },
          { path: '/api/orders/regression-missing-order/pay-with-credits' },
          { path: '/api/orders/regression-missing-order/cancel' },
      ];
      for (const route of routes) {
          const method = route.method ?? 'POST';
          const init = { method, body: method === 'GET' || route.body === undefined ? undefined : JSON.stringify(route.body) };
          // Plain fetch: authFetch would attach the signed-in admin's token.
          const anonymous = await fetch(route.path, { ...init, headers: { 'Content-Type': 'application/json' } });
          if (anonymous.status !== 401) throw new Error(`${method} ${route.path}: expected 401 without auth, got ${anonymous.status}`);
          const authed = await authFetch(route.path, {
              ...init,
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${booksToken}` },
          });
          const expected = route.expectAuthed ?? 404;
          if (authed.status !== expected) throw new Error(`${method} ${route.path}: expected ${expected} authed, got ${authed.status}`);
      }
      updateTestResult('API_BOOKS_V3_AUTH', {
          status: 'PASS',
          message: 'manuscripts, books (create/list/get), retry, lock, unlock, print-options, renders and orders reject anonymous calls (401); authed calls return 404 for missing ids and 200 for the Books list.',
      });
  } catch (e: any) {
      updateTestResult('API_BOOKS_V3_AUTH', { status: 'ERROR', message: e.message });
  }

  // Test: API_STORIES_V3_AUTH — the creation routes (slice 5.3). All four
  // reject anonymous calls (401). Authenticated calls on a child or story that
  // does not exist get past the auth gate and return 404, so no Story is
  // created, no allowance is checked or charged and no AI runs. The engines and
  // story.finish are covered by src/server/creation/__tests__/.
  try {
      const storiesToken = await auth?.currentUser?.getIdToken?.();
      if (!storiesToken) throw new Error('Admin authentication required for stories auth test.');
      const missingStory = 'regression-missing-story';
      const routes: Array<{ path: string; body?: unknown }> = [
          { path: '/api/stories', body: { childId: 'regression-missing-child', modeId: 'wizard', idempotencyKey: 'regression-stories-auth' } },
          { path: `/api/stories/${missingStory}/turns`, body: { input: { kind: 'choice', optionId: 'A' }, idempotencyKey: 'regression-turns-auth' } },
          { path: `/api/stories/${missingStory}/abandon` },
          { path: `/api/stories/${missingStory}/finish` },
      ];
      for (const route of routes) {
          const init = { method: 'POST', body: route.body === undefined ? undefined : JSON.stringify(route.body) };
          // Plain fetch: authFetch would attach the signed-in admin's token.
          const anonymous = await fetch(route.path, { ...init, headers: { 'Content-Type': 'application/json' } });
          if (anonymous.status !== 401) throw new Error(`${route.path}: expected 401 without auth, got ${anonymous.status}`);
          const authed = await authFetch(route.path, {
              ...init,
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storiesToken}` },
          });
          if (authed.status !== 404) throw new Error(`${route.path}: expected 404 for a missing id, got ${authed.status}`);
      }
      updateTestResult('API_STORIES_V3_AUTH', {
          status: 'PASS',
          message: 'stories, turns, abandon and finish reject anonymous calls (401) and return 404 for missing ids.',
      });
  } catch (e: any) {
      updateTestResult('API_STORIES_V3_AUTH', { status: 'ERROR', message: e.message });
  }

  // Test: API_STORIES_READ — the read routes (slice 5.4). Anonymous calls are
  // refused (401); a missing child or story is 404; the mode list has the
  // kid-safe shape (no prompts, exactly one recommended when any exist).
  try {
      const readToken = await auth?.currentUser?.getIdToken?.();
      if (!readToken) throw new Error('Admin authentication required for stories read test.');
      const reads: Array<{ path: string; authed: number }> = [
          { path: '/api/stories?childId=regression-missing-child', authed: 404 },
          { path: '/api/stories/regression-missing-story', authed: 404 },
          { path: '/api/creation-modes', authed: 200 },
      ];
      for (const read of reads) {
          const anonymous = await fetch(read.path, { cache: 'no-store' });
          if (anonymous.status !== 401) throw new Error(`${read.path}: expected 401 without auth, got ${anonymous.status}`);
          const authed = await authFetch(read.path, { headers: { Authorization: `Bearer ${readToken}` }, cache: 'no-store' });
          if (authed.status !== read.authed) throw new Error(`${read.path}: expected ${read.authed}, got ${authed.status}`);
          if (read.path === '/api/creation-modes') {
              const body = await authed.json();
              const modes = body?.data?.modes;
              if (!Array.isArray(modes)) throw new Error('creation-modes: data.modes is not an array');
              if (modes.some((m: any) => !m.modeId || !m.name || 'prompts' in m)) throw new Error('creation-modes: a mode has the wrong shape');
              if (modes.length > 0 && modes.filter((m: any) => m.recommended).length !== 1) throw new Error('creation-modes: expected exactly one recommended mode');
          }
      }
      updateTestResult('API_STORIES_READ', { status: 'PASS', message: 'Story list, story and mode list refuse anonymous calls; missing ids are 404; modes have the kid-safe shape.' });
  } catch (e: any) {
      updateTestResult('API_STORIES_READ', { status: 'ERROR', message: e.message });
  }

  // Test: API_ADMIN_ALLOWANCES — anonymous 401; the admin reads their own family's
  // allowances (read-only: nothing is adjusted).
  try {
      const anonymous = await globalThis.fetch('/api/admin/allowances?q=x', { cache: 'no-store' });
      if (anonymous.status !== 401) throw new Error(`anonymous: expected 401, got ${anonymous.status}`);
      const uid = auth?.currentUser?.uid;
      if (!uid) throw new Error('Admin authentication required for allowances test.');
      const res = await authFetch(`/api/admin/allowances?q=${encodeURIComponent(uid)}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok || !Array.isArray(body?.data?.family) || !Array.isArray(body?.data?.history)) {
          throw new Error(`unexpected response ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      }
      updateTestResult('API_ADMIN_ALLOWANCES', { status: 'PASS', message: `Read ${body.data.family.length} family balances, ${body.data.history.length} history entries.` });
  } catch (e: any) {
      updateTestResult('API_ADMIN_ALLOWANCES', { status: 'ERROR', message: e.message });
  }

  // Test: API_LIBRARY_SUMMARY — counts for the caller's family; anonymous 401.
  try {
      const anonymous = await globalThis.fetch('/api/library/summary', { cache: 'no-store' });
      if (anonymous.status !== 401) throw new Error(`anonymous: expected 401, got ${anonymous.status}`);
      const res = await authFetch('/api/library/summary', { cache: 'no-store' });
      const body = await res.json();
      const totals = body?.data?.totals;
      if (!res.ok || typeof totals?.stories !== 'number' || typeof totals?.books !== 'number' || typeof body?.data?.byChild !== 'object') {
          throw new Error(`unexpected response ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      }
      updateTestResult('API_LIBRARY_SUMMARY', { status: 'PASS', message: `Totals: ${totals.stories} stories, ${totals.books} books.` });
  } catch (e: any) {
      updateTestResult('API_LIBRARY_SUMMARY', { status: 'ERROR', message: e.message });
  }

  // Test: API_ADMIN_TRACE — the Book/Story trace route: anonymous 401, no id
  // 400, an unknown Book 404. Read-only.
  try {
      const traceToken = await auth?.currentUser?.getIdToken?.();
      if (!traceToken) throw new Error('Admin authentication required for trace test.');
      const anonymous = await globalThis.fetch('/api/admin/trace?bookId=bk_regression', { cache: 'no-store' });
      if (anonymous.status !== 401) throw new Error(`anonymous: expected 401, got ${anonymous.status}`);
      const headers = { Authorization: `Bearer ${traceToken}` };
      const noId = await authFetch('/api/admin/trace', { headers, cache: 'no-store' });
      if (noId.status !== 400) throw new Error(`no id: expected 400, got ${noId.status}`);
      const missing = await authFetch('/api/admin/trace?bookId=bk_regression_missing', { headers, cache: 'no-store' });
      if (missing.status !== 404) throw new Error(`missing book: expected 404, got ${missing.status}`);
      updateTestResult('API_ADMIN_TRACE', { status: 'PASS', message: 'Trace refuses anonymous calls, requires an id and 404s an unknown Book.' });
  } catch (e: any) {
      updateTestResult('API_ADMIN_TRACE', { status: 'ERROR', message: e.message });
  }

  // Test: API_PERSONA — the persona cookie endpoint (Sprint W4-A).
  // Validation-only: never sets a real child persona for the admin (that
  // would scope this browser's subsequent generation requests); finishes
  // with DELETE so the suite always leaves the browser unscoped.
  try {
      const personaToken = await auth?.currentUser?.getIdToken?.();
      if (!personaToken) throw new Error('Admin authentication required for persona test.');

      // 1. Unauthenticated -> 401
      const unauthedPersonaRes = await globalThis.fetch('/api/persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ childId: 'regression-persona-child' }),
      });
      if (unauthedPersonaRes.status !== 401) throw new Error(`Expected 401 without auth, got ${unauthedPersonaRes.status}`);

      const personaHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${personaToken}` };

      // 2. Bad childId type -> 400
      const badPersonaRes = await authFetch('/api/persona', {
          method: 'POST', headers: personaHeaders, body: JSON.stringify({ childId: 123 }),
      });
      if (badPersonaRes.status !== 400) throw new Error(`Expected 400 for non-string childId, got ${badPersonaRes.status}`);

      // 3. Unknown childId -> 404 (or 503 when no signing secret is configured locally)
      const missingPersonaRes = await authFetch('/api/persona', {
          method: 'POST', headers: personaHeaders, body: JSON.stringify({ childId: 'regression-persona-nonexistent-child' }),
      });
      if (missingPersonaRes.status !== 404 && missingPersonaRes.status !== 503) {
          throw new Error(`Expected 404 for unknown childId (or 503 unconfigured), got ${missingPersonaRes.status}`);
      }

      // 4. DELETE clears (no auth required by design — sign-out path)
      const clearPersonaRes = await authFetch('/api/persona', { method: 'DELETE' });
      if (!clearPersonaRes.ok) throw new Error(`Expected DELETE to clear the persona, got ${clearPersonaRes.status}`);

      updateTestResult('API_PERSONA', {
          status: 'PASS',
          message: 'persona requires auth (401), validates childId (400 bad type, 404 unknown), and DELETE clears the cookie. Browser left unscoped.',
      });
  } catch (e: any) {
      updateTestResult('API_PERSONA', { status: 'ERROR', message: e.message });
  }

  // Test: API_VERIFY_PIN_LOCKOUT — verify-pin brute-force lockout policy
  // (Sprint W4-A). Uses the dryRun seam: reports the lockout configuration
  // and current state WITHOUT comparing a PIN or recording an attempt, so
  // the admin account can never be locked out by this suite.
  try {
      const pinDryRunToken = await auth?.currentUser?.getIdToken?.();
      if (!pinDryRunToken) throw new Error('Admin authentication required for verify-pin lockout test.');
      const pinDryRunHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${pinDryRunToken}` };

      const dryRunRes = await authFetch('/api/parent/verify-pin', {
          method: 'POST', headers: pinDryRunHeaders, body: JSON.stringify({ dryRun: true }),
      });
      const dryRunPayload = await dryRunRes.json();
      if (!dryRunRes.ok || dryRunPayload?.ok !== true || dryRunPayload?.dryRun !== true) {
          throw new Error(`Expected dry-run 200, got ${dryRunRes.status}: ${dryRunPayload?.message || ''}`);
      }
      if (dryRunPayload?.lockout?.maxAttempts !== 5 || dryRunPayload?.lockout?.lockoutMs !== 300000) {
          throw new Error(`Unexpected lockout config: ${JSON.stringify(dryRunPayload?.lockout)}`);
      }
      if (typeof dryRunPayload?.failedAttempts !== 'number' || typeof dryRunPayload?.locked !== 'boolean') {
          throw new Error('Dry-run response missing failedAttempts/locked state.');
      }

      // Format validation still rejects without recording an attempt.
      const shortPinRes = await authFetch('/api/parent/verify-pin', {
          method: 'POST', headers: pinDryRunHeaders, body: JSON.stringify({ pin: '12' }),
      });
      if (shortPinRes.status !== 400) throw new Error(`Expected 400 for short PIN, got ${shortPinRes.status}`);

      updateTestResult('API_VERIFY_PIN_LOCKOUT', {
          status: 'PASS',
          message: `Lockout policy live (${dryRunPayload.lockout.maxAttempts} attempts / ${dryRunPayload.lockout.lockoutMs / 60000} min); locked=${dryRunPayload.locked}, failedAttempts=${dryRunPayload.failedAttempts}; bad format 400s. Non-destructive (dryRun).`,
      });
  } catch (e: any) {
      updateTestResult('API_VERIFY_PIN_LOCKOUT', { status: 'ERROR', message: e.message });
  }

  // Test: SCENARIO_LIKENESS_PHOTO_JOBS
  // Adds a minimal photo through POST /api/children/{id}/photos (slice 5.7) and checks that
  // the photo is stored and the appearance and portrait jobs are queued.
  try {
      const authToken = await auth?.currentUser?.getIdToken?.();
      if (!authToken) throw new Error('Admin auth token not available.');

      const childRef = await createRegressionChild({
          displayName: 'Photo Trigger Test Child',
          ownerUid: `${REGRESSION_SUITE_TAG}-photo-parent`,
          createdAt: serverTimestamp(),
          likes: [],
          dislikes: [],
      }, 'SCENARIO_LIKENESS_PHOTO_JOBS');

      // Minimal 1×1 PNG
      const MINIMAL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';

      const uploadRes = await authFetch(`/api/children/${encodeURIComponent(childRef.id)}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ dataUrl: MINIMAL_PNG }),
      });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok || !uploadBody?.ok) {
          throw new Error(uploadBody?.error?.message || `Photo upload API returned ${uploadRes.status}`);
      }
      const view = uploadBody.data;
      if (!Array.isArray(view?.photoIds) || view.photoIds.length !== 1) {
          throw new Error(`Expected 1 photo after upload, got ${Array.isArray(view?.photoIds) ? view.photoIds.length : typeof view?.photoIds}.`);
      }
      const status = view.likenessStatus ?? {};
      if (status.describe === 'idle' || status.portrait === 'idle') {
          throw new Error(`Expected appearance and portrait jobs queued, got describe=${status.describe}, portrait=${status.portrait}.`);
      }

      updateTestResult('SCENARIO_LIKENESS_PHOTO_JOBS', {
          status: 'PASS',
          message: `Photo stored; describe=${status.describe}, portrait=${status.portrait}.`,
      });
  } catch (e: any) {
      updateTestResult('SCENARIO_LIKENESS_PHOTO_JOBS', { status: 'ERROR', message: e.message });
  }

  // --- API Tests ---

  // Test: API_USER_ONBOARDING_GET — derived first-run checklist shape.
  // Read-only for established accounts (state is cached once complete/dismissed).
  try {
      const onboardingToken = await auth?.currentUser?.getIdToken?.();
      if (!onboardingToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/user/onboarding', {
          headers: { Authorization: `Bearer ${onboardingToken}` },
      });
      const result = await response.json();
      if (response.status !== 200) {
          throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
      }
      if (result.ok !== true) throw new Error('API response missing ok:true.');
      if (!Array.isArray(result.steps) || result.steps.length !== 5) {
          throw new Error(`Expected 5 onboarding steps, got ${Array.isArray(result.steps) ? result.steps.length : typeof result.steps}.`);
      }
      const badStep = result.steps.find((s: any) => !s.id || typeof s.complete !== 'boolean' || !s.href);
      if (badStep) throw new Error('A step is missing id/complete/href.');
      if (typeof result.complete !== 'boolean' || typeof result.dismissed !== 'boolean') {
          throw new Error('Response missing complete/dismissed booleans.');
      }
      updateTestResult('API_USER_ONBOARDING_GET', { status: 'PASS', message: `5 steps returned; complete=${result.complete}, dismissed=${result.dismissed}.` });
  } catch (e: any) {
      updateTestResult('API_USER_ONBOARDING_GET', { status: 'FAIL', message: e.message });
  }

  // Test: API_USER_ONBOARDING_POST — input validation only (no state mutation:
  // an unknown action must be rejected with 400 before any write).
  try {
      const onboardingToken = await auth?.currentUser?.getIdToken?.();
      if (!onboardingToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/user/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${onboardingToken}` },
          body: JSON.stringify({ action: 'regression-bogus-action' }),
      });
      if (response.status !== 400) {
          throw new Error(`Expected 400 for unknown action, got ${response.status}.`);
      }
      updateTestResult('API_USER_ONBOARDING_POST', { status: 'PASS', message: 'Unknown action correctly rejected with 400.' });
  } catch (e: any) {
      updateTestResult('API_USER_ONBOARDING_POST', { status: 'FAIL', message: e.message });
  }

  // Test: API_ADMIN_OPS_METRICS — ops dashboard metrics shape (read-only).
  try {
      const opsToken = await auth?.currentUser?.getIdToken?.();
      if (!opsToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/admin/ops/metrics', {
          headers: { Authorization: `Bearer ${opsToken}` },
      });
      const result = await response.json();
      if (response.status !== 200) {
          throw new Error(`API returned status ${response.status}: ${result.errorMessage || 'Unknown error'}`);
      }
      if (result.ok !== true) throw new Error('API response missing ok:true.');
      if (typeof result.analytics?.activeUsers?.available !== 'boolean') {
          throw new Error('analytics.activeUsers missing available flag.');
      }
      if (typeof result.analytics?.funnel?.available !== 'boolean') {
          throw new Error('analytics.funnel missing available flag.');
      }
      if (typeof result.generation?.total !== 'number' || typeof result.generation?.errorRate !== 'number') {
          throw new Error('generation section missing total/errorRate numbers.');
      }
      if (typeof result.printOrders?.placed !== 'number' || !result.printOrders?.conversion) {
          throw new Error('printOrders section missing placed/conversion.');
      }
      const phState = result.analytics.activeUsers.available ? 'PostHog live' : 'PostHog gated';
      updateTestResult('API_ADMIN_OPS_METRICS', { status: 'PASS', message: `Metrics OK (${phState}); ${result.generation.total} flow runs, ${result.printOrders.placed} orders in window.` });
  } catch (e: any) {
      updateTestResult('API_ADMIN_OPS_METRICS', { status: 'FAIL', message: e.message });
  }

  // Test: API_ADMIN_OPS_HEALTH_CHECK — dry-run evaluates checks without alerting/persisting.
  try {
      const opsToken = await auth?.currentUser?.getIdToken?.();
      if (!opsToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/admin/ops/health-check?dryRun=1', {
          method: 'POST',
          headers: { Authorization: `Bearer ${opsToken}` },
      });
      const result = await response.json();
      if (response.status !== 200) {
          throw new Error(`API returned status ${response.status}: ${result.errorMessage || 'Unknown error'}`);
      }
      if (result.ok !== true) throw new Error('API response missing ok:true.');
      if (result.dryRun !== true) throw new Error('Expected dryRun:true in response.');
      if (!Array.isArray(result.results) || result.results.length !== 3) {
          throw new Error(`Expected 3 health-check results, got ${Array.isArray(result.results) ? result.results.length : typeof result.results}.`);
      }
      const badCheck = result.results.find((r: any) => !r.id || typeof r.breached !== 'boolean' || !r.summary);
      if (badCheck) throw new Error('A health-check result is missing id/breached/summary.');
      if (!Array.isArray(result.alertsSent) || result.alertsSent.length !== 0) {
          throw new Error('Dry run must not send alerts.');
      }
      updateTestResult('API_ADMIN_OPS_HEALTH_CHECK', { status: 'PASS', message: `3 checks evaluated (healthy=${result.healthy}); no alerts on dry run.` });
  } catch (e: any) {
      updateTestResult('API_ADMIN_OPS_HEALTH_CHECK', { status: 'FAIL', message: e.message });
  }

  // Test: API_HEALTH — canary/rollback probe (W3-B). Read-only; verifies the
  // verbose body shape (version + firestore dependency probe). A 'degraded'
  // 503 is a FAIL (the probe is doing its job — the dependency is down).
  try {
      const response = await authFetch('/api/health', { cache: 'no-store' });
      const result = await response.json();
      if (!result.version || typeof result.version !== 'string') {
          throw new Error('Response missing version (build SHA).');
      }
      if (result.status === 'ok' && result.checks === undefined) {
          // Minimal body — the health_verbose flag is off; still a valid state.
          updateTestResult('API_HEALTH', { status: 'PASS', message: `Minimal body (health_verbose=false); version=${result.version}.` });
      } else if (response.status === 200 && result.status === 'ok') {
          if (result.checks?.firestore?.ok !== true) throw new Error('Firestore probe not ok despite status ok.');
          if (typeof result.uptimeSeconds !== 'number') throw new Error('Response missing uptimeSeconds.');
          updateTestResult('API_HEALTH', { status: 'PASS', message: `ok; version=${result.version}; firestore ${result.checks.firestore.latencyMs}ms.` });
      } else {
          throw new Error(`Status ${response.status}/${result.status}; firestore error: ${result.checks?.firestore?.error || 'unknown'}`);
      }
  } catch (e: any) {
      updateTestResult('API_HEALTH', { status: 'FAIL', message: e.message });
  }

  // Test: API_AUTH_PASSWORD_RESET — public route; an invalid address is a 400.
  // A valid address is not tried: it would email a real person.
  try {
      const bad = await globalThis.fetch('/api/auth/password-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'not-an-email' }),
          cache: 'no-store',
      });
      if (bad.status !== 400) throw new Error(`invalid email: expected 400, got ${bad.status}`);
      updateTestResult('API_AUTH_PASSWORD_RESET', { status: 'PASS', message: 'Rejects an invalid address with 400.' });
  } catch (e: any) {
      updateTestResult('API_AUTH_PASSWORD_RESET', { status: 'FAIL', message: e.message });
  }

  // Test: API_ROUTE_AUTH_ANON — Phase 0 route auth. Calls protected routes
  // with NO token (plain fetch, deliberately not authFetch) and expects a
  // refusal before any AI call, Firestore read or upstream billing happens.
  // The IDs are placeholders; a 404 would mean auth ran too late.
  try {
      const anonymous: Array<{ path: string; init?: RequestInit; expect: number[] }> = [
          { path: '/api/postcode/lookup?postcode=SW1A1AA', expect: [401] },
          { path: '/api/webhooks/mixam', init: { method: 'POST', body: '{}' }, expect: [401, 503] },
          // Unsigned Stripe events: 400 (bad signature), or 503 while Stripe is not configured.
          { path: '/api/webhooks/stripe', init: { method: 'POST', body: '{}' }, expect: [400, 503] },
          { path: '/api/admin/orders', expect: [401] },
          { path: '/api/admin/orders/settings', expect: [401] },
          // Children and characters (slice 5.7a): every route refuses anonymous calls.
          { path: '/api/children', init: { method: 'POST', body: '{}' }, expect: [401] },
          { path: '/api/characters', expect: [401] },
          { path: '/api/characters/regression-anon/photos', init: { method: 'POST', body: '{}' }, expect: [401] },
          { path: '/api/children/regression-anon/avatar', init: { method: 'POST', body: '{}' }, expect: [401] },
          { path: '/api/admin/children/regression-anon', init: { method: 'PATCH', body: '{}' }, expect: [401] },
          { path: '/api/admin/children?ownerUid=regression-anon', init: { method: 'GET' }, expect: [401] },
          { path: '/api/admin/catalog/storyTypes/regression-anon', init: { method: 'PATCH', body: '{"data":{}}' }, expect: [401] },
          { path: '/api/admin/catalog/storyTypes', init: { method: 'POST', body: '{"data":{}}' }, expect: [401] },
          { path: '/api/admin/characters?ownerUid=regression-anon', init: { method: 'GET' }, expect: [401] },
      ];
      const failures: string[] = [];
      for (const { path, init, expect } of anonymous) {
          const response = await globalThis.fetch(path, {
              ...init,
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
          });
          if (!expect.includes(response.status)) failures.push(`${path} → ${response.status}`);
      }
      if (failures.length > 0) throw new Error(`Not rejected: ${failures.join('; ')}`);
      updateTestResult('API_ROUTE_AUTH_ANON', { status: 'PASS', message: `${anonymous.length} protected routes refused anonymous calls.` });
  } catch (e: any) {
      updateTestResult('API_ROUTE_AUTH_ANON', { status: 'FAIL', message: e.message });
  }

  // Test: API_FLAGS — server-evaluated feature flags (W3-B). Read-only;
  // verifies every value is a boolean and the worked-example flag is present.
  try {
      const flagsToken = await auth?.currentUser?.getIdToken?.();
      const response = await authFetch('/api/flags', {
          headers: flagsToken ? { Authorization: `Bearer ${flagsToken}` } : undefined,
          cache: 'no-store',
      });
      const result = await response.json();
      if (response.status !== 200 || result.ok !== true) {
          throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
      }
      if (!result.flags || typeof result.flags !== 'object') throw new Error('Response missing flags map.');
      if (typeof result.flags.health_verbose !== 'boolean') throw new Error('flags.health_verbose missing or not boolean.');
      const nonBoolean = Object.entries(result.flags).find(([, v]) => typeof v !== 'boolean');
      if (nonBoolean) throw new Error(`Flag '${nonBoolean[0]}' is not a boolean.`);
      updateTestResult('API_FLAGS', { status: 'PASS', message: `${Object.keys(result.flags).length} flag(s); authenticated=${result.authenticated}.` });
  } catch (e: any) {
      updateTestResult('API_FLAGS', { status: 'FAIL', message: e.message });
  }

  // ── Sprint W3-C: feedback / tickets / order-timeline APIs ──────────────
  // Validation-only checks: nothing below mutates state (no feedback docs,
  // no tickets, no emails) so the suite stays repeatable.

  // Test: API_FEEDBACK_POST_VALIDATION — bogus trigger must be rejected with 400.
  try {
      const w3cToken = await auth?.currentUser?.getIdToken?.();
      if (!w3cToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${w3cToken}` },
          body: JSON.stringify({ trigger: 'regression-bogus-trigger', subjectId: 'regression', action: 'submitted', rating: 5 }),
      });
      if (response.status !== 400) {
          throw new Error(`Expected 400 for unknown trigger, got ${response.status}.`);
      }
      updateTestResult('API_FEEDBACK_POST_VALIDATION', { status: 'PASS', message: 'Unknown trigger correctly rejected with 400.' });
  } catch (e: any) {
      updateTestResult('API_FEEDBACK_POST_VALIDATION', { status: 'FAIL', message: e.message });
  }

  // Test: API_FEEDBACK_ELIGIBILITY — read-only eligibility check returns a boolean.
  try {
      const w3cToken = await auth?.currentUser?.getIdToken?.();
      if (!w3cToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/feedback/eligibility?trigger=book_first_view&subjectId=regression-nonexistent-book', {
          headers: { Authorization: `Bearer ${w3cToken}` },
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
      if (result.ok !== true || typeof result.eligible !== 'boolean') {
          throw new Error('Response missing ok:true / eligible boolean.');
      }
      updateTestResult('API_FEEDBACK_ELIGIBILITY', { status: 'PASS', message: `Eligibility check returned eligible=${result.eligible}.` });
  } catch (e: any) {
      updateTestResult('API_FEEDBACK_ELIGIBILITY', { status: 'FAIL', message: e.message });
  }

  // Test: API_TICKETS_GET — own-tickets list shape.
  try {
      const w3cToken = await auth?.currentUser?.getIdToken?.();
      if (!w3cToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/tickets', {
          headers: { Authorization: `Bearer ${w3cToken}` },
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(`API returned status ${response.status}: ${result.error || 'Unknown error'}`);
      if (result.ok !== true || !Array.isArray(result.tickets)) throw new Error('Response missing ok:true / tickets array.');
      const badTicket = result.tickets.find((t: any) => !t.id || !['open', 'in_progress', 'resolved'].includes(t.status));
      if (badTicket) throw new Error(`Ticket ${badTicket.id || '?'} has an invalid status.`);
      updateTestResult('API_TICKETS_GET', { status: 'PASS', message: `${result.tickets.length} ticket(s) returned with valid statuses.` });
  } catch (e: any) {
      updateTestResult('API_TICKETS_GET', { status: 'FAIL', message: e.message });
  }

  // Test: API_REPORT_ISSUE_VALIDATION — missing message must be rejected with 400
  // (validated before any ticket write or email).
  try {
      const w3cToken = await auth?.currentUser?.getIdToken?.();
      if (!w3cToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/report-issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${w3cToken}` },
          body: JSON.stringify({ pagePath: '/admin/regression' }),
      });
      if (response.status !== 400) {
          throw new Error(`Expected 400 for missing message, got ${response.status}.`);
      }
      updateTestResult('API_REPORT_ISSUE_VALIDATION', { status: 'PASS', message: 'Missing message correctly rejected with 400 (no ticket created).' });
  } catch (e: any) {
      updateTestResult('API_REPORT_ISSUE_VALIDATION', { status: 'FAIL', message: e.message });
  }

  // Test: API_MY_ORDERS_TIMELINE — GET /api/orders (slice 5.6): the caller's orders, each with
  // its server-built timeline and the actions the client may offer.
  try {
      const ordersToken = await auth?.currentUser?.getIdToken?.();
      if (!ordersToken) throw new Error('Authentication required.');
      const response = await authFetch('/api/orders', { headers: { Authorization: `Bearer ${ordersToken}` } });
      const result = await response.json();
      if (response.status !== 200) throw new Error(`API returned status ${response.status}: ${result.error?.message || 'Unknown error'}`);
      if (result.ok !== true || !Array.isArray(result.data)) throw new Error('Response missing ok:true / data array.');
      const badOrder = result.data.find((o: any) => !Array.isArray(o.timeline) || typeof o.status !== 'string' || typeof o.actions?.canCancel !== 'boolean');
      if (badOrder) throw new Error(`Order ${badOrder.id || '?'} is missing its timeline, status or actions.`);
      updateTestResult('API_MY_ORDERS_TIMELINE', { status: 'PASS', message: `${result.data.length} order(s), each with a timeline and actions.` });
  } catch (e: any) {
      updateTestResult('API_MY_ORDERS_TIMELINE', { status: 'FAIL', message: e.message });
  }

  setDiagnostics((prev: any) => ({...prev, apiSummary: {...prev.apiSummary, ...apiSummary } }));
  } finally {
      await cleanupRegressionArtifacts(firestore, artifacts);
  }
}
