/**
 * Probe goals: the user journeys the personas pursue, expressed exclusively
 * through perceivable affordances (see driver.ts for the validity guard).
 *
 * ONE script per goal, executed by every persona INCLUDING the expert
 * baseline: the path itself is the optimal one, so the expert run defines
 * optimal actions/time, while constrained personas diverge through their
 * budgets, patience and fallback behaviour. A reintroduced affordance
 * regression (e.g. the "Add your first child" CTA disappearing) dead-ends the
 * impatient persona and detours the first-time parent — both visible in the
 * scores and findings.
 *
 * Funnel steps are marked with the canonical ANALYTICS_EVENTS names
 * (concordance contract — see concordance.ts).
 */
import type { Page } from 'playwright/test';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics/events';
import {
  SEED,
  findChildId,
  findUidByEmail,
  seedCatalog,
  seedCompletedStory,
  seedReadyStorybook,
} from '../helpers/emulator';
import {
  createChildViaParentUI,
  signUpNewParent,
} from '../helpers/flows';
import { E2E_PASSWORD, E2E_PIN, uniqueEmail } from '../helpers/test-env';
import { PersonaDriver } from './driver';
import type { ProbeRecorder } from './recorder';

export type GoalContext = {
  page: Page;
  drv: PersonaDriver;
  rec: ProbeRecorder;
  /** Unique tag for account emails. */
  tag: string;
  /** The goal reports the created account uid here ASAP so the spec can clean
   * up even when the run fails mid-way. */
  state: { uid?: string };
};

export type GoalDef = {
  id: string;
  title: string;
  description: string;
  /** Set up preconditions outside the recorded run (not budgeted). */
  prepare?: (ctx: GoalContext) => Promise<void>;
  run: (ctx: GoalContext) => Promise<void>;
};

const CHILD_NAME = 'Probe Child';

/** How long a persona tolerates the explicit "making your book" progress UI. */
const GENERATION_PATIENCE_MS = 90_000;

/**
 * Goal 1 — the activation journey: fresh signup to a finished picture book.
 *
 * Story completion uses the same deterministic seam as the blocking funnel
 * spec (the wizard is a live AI call with no TEST_MODE seam): the probe
 * asserts the story-creation entry, then seeds the exact wizard/storyCompile
 * post-conditions and resumes UI-driven. The seam is marked `simulated` in the
 * funnel record so reports never count it as UI-earned conversion.
 */
export const REACH_FINISHED_BOOK: GoalDef = {
  id: 'reach-finished-book',
  title: 'Reach a finished book from a fresh signup',
  description:
    'Sign up, create a child profile, start a story, and get a finished picture book.',
  prepare: async () => {
    await seedCatalog();
  },
  run: async (ctx) => {
    const { drv, rec } = ctx;
    const email = uniqueEmail(`probe-${ctx.tag}`);

    // ── Sign up ──
    await drv.goto('open the signup page', '/signup');
    await drv.fill('enter email', email, { label: 'Email' });
    await drv.fill('enter password', E2E_PASSWORD, { label: 'Password' });
    await drv.fill('choose a parent PIN', E2E_PIN, { label: '4-Digit Parent PIN' });
    await drv.fill('confirm the PIN', E2E_PIN, { label: 'Confirm PIN' });
    await drv.click('submit signup', { role: 'button', name: 'Sign Up' });
    await drv.see('land on the family home screen', { text: 'Who is playing?' });
    rec.markFunnelStep(ANALYTICS_EVENTS.signupCompleted);
    ctx.state.uid = await findUidByEmail(email);

    // ── Create the first child ──
    // Primary: the first-run CTA on the empty home screen (W1-C fix).
    // Fallback (patient personas only): the parent-area nav link.
    await drv.click(
      'find where to add a child',
      { role: 'link', name: 'Add your first child' },
      { role: 'link', name: /switch to parent|manage children/i },
    );
    // The PIN guard may interpose (it should NOT right after signup — the
    // fresh-PIN grace). If it does, the persona knows the PIN it just chose.
    const which = await drv.seeEither(
      'reach the children manager',
      { role: 'button', name: /add new child/i },
      { text: 'Enter Parent PIN' },
    );
    if (which === 2) {
      await drv.fill('re-enter the PIN chosen seconds ago', E2E_PIN, { placeholder: '****' });
      await drv.click('unlock the parent area', { role: 'button', name: 'Unlock' });
      await drv.see('reach the children manager', { role: 'button', name: /add new child/i });
    }
    await drv.click('start adding a child', { role: 'button', name: /add new child/i });
    await drv.see('see the new-child form', { text: 'Create New Child Profile' });
    await drv.fill("enter the child's name", CHILD_NAME, { placeholder: 'Child name' });
    await drv.click('create the child', { role: 'button', name: /^create$/i });
    await drv.see('see the child in the list', { text: CHILD_NAME });
    rec.markFunnelStep(ANALYTICS_EVENTS.childCreated);

    // ── Enter the kids surface as that child ──
    await drv.goto('open the kids app', '/kids/setup');
    await drv.click('choose who is playing', { role: 'button', name: new RegExp(CHILD_NAME, 'i') });
    await drv.see('land on the kids home', { text: 'Welcome back' });

    // ── Story creation entry ──
    await drv.click('start a new story', { text: 'Create New Story' });
    await drv.see('see the story-method chooser', {
      role: 'heading',
      name: 'How do you want to create your story?',
    });
    await drv.see('see a story method to pick', { text: SEED.generatorName });
    rec.markFunnelStep(ANALYTICS_EVENTS.storyStarted);

    // ── Story completion: deterministic seam (no wizard AI seam exists) ──
    const childId = await findChildId(ctx.state.uid, CHILD_NAME);
    await seedCompletedStory({ parentUid: ctx.state.uid, childId });
    rec.markFunnelStep(ANALYTICS_EVENTS.storyCompleted, { simulated: true });

    // ── Find the story and make a book from it ──
    // Back out of the chooser (client-side; cold deep-links crash — known app
    // issue, docs/testing/e2e.md).
    await drv.back('go back to the kids home');
    await drv.see('back on the kids home', { text: 'Welcome back' });
    await drv.click('open my stories', { text: 'My Stories' });
    await drv.see('see the finished story', { text: SEED.storyTitle });
    await drv.click('open the story', { role: 'link', name: 'Read Story' });
    await drv.see('see the story page', { role: 'heading', name: SEED.storyTitle });
    await drv.click('turn it into a picture book', { role: 'link', name: /create picture book/i });

    // ── Book type + art style ──
    await drv.see('see the book-type chooser', { role: 'heading', name: 'Choose Your Book Type' });
    await drv.click('pick a book type', { text: SEED.outputTypeLabel });
    await drv.see('see the art-style chooser', { role: 'heading', name: 'Pick Your Art Style' });
    await drv.click('pick an art style', { text: SEED.imageStyleTitle });
    rec.markFunnelStep(ANALYTICS_EVENTS.storybookGenerationStarted);

    // ── Wait through generation (explicit progress UI → extra patience) ──
    await drv.seeWithin(
      'wait for the book to be made',
      { role: 'heading', name: 'My Books' },
      GENERATION_PATIENCE_MS,
    );
    await drv.see('see the finished book', { text: SEED.storyTitle });
    rec.markFunnelStep(ANALYTICS_EVENTS.storybookArtReady);
  },
};

/**
 * Goal 2 — the retention journey: a returning child re-opens the kids PWA on
 * a shared device and reads an existing book. Preconditions (account, child,
 * finished book) are seeded outside the budget; the recorded run starts at
 * the kids profile chooser.
 */
export const READ_EXISTING_BOOK: GoalDef = {
  id: 'read-existing-book',
  title: 'Returning child reads an existing book',
  description:
    'From the kids profile chooser, reach an already-finished book and start reading it.',
  prepare: async (ctx) => {
    await seedCatalog();
    const account = await signUpNewParent(ctx.page, `probe-prep-${ctx.tag}`);
    ctx.state.uid = account.uid;
    await createChildViaParentUI(ctx.page, account, CHILD_NAME);
    const childId = await findChildId(account.uid, CHILD_NAME);
    const { sessionId } = await seedCompletedStory({ parentUid: account.uid, childId });
    await seedReadyStorybook({ storyId: sessionId });
  },
  run: async (ctx) => {
    const { drv } = ctx;
    await drv.goto('open the kids app', '/kids/setup');
    await drv.click('choose who is playing', { role: 'button', name: new RegExp(CHILD_NAME, 'i') });
    await drv.see('land on the kids home', { text: 'Welcome back' });
    await drv.click('open my books', { text: 'My Books' });
    await drv.see('see the bookshelf', { role: 'heading', name: 'My Books' });
    await drv.click('open the book', { text: SEED.storyTitle });
    await drv.see('see the book is ready to read', { role: 'button', name: /read myself/i });
    await drv.click('start reading', { role: 'button', name: /read myself/i });
    // The immersive reader opens on the first story page (the title page is
    // shown on the open screen, not as a reader page).
    await drv.see('see the first page', { text: 'Once upon a test' });
  },
};

export const GOALS: GoalDef[] = [REACH_FINISHED_BOOK, READ_EXISTING_BOOK];
