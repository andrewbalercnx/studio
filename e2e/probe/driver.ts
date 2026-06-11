/**
 * Perception-constrained persona driver.
 *
 * Validity guard inherited from the POC (tools/probe/server.mjs): personas may
 * only target what a user can perceive — ARIA role + accessible name, form
 * labels/placeholders, or visible text. CSS selectors and data-testids are
 * deliberately NOT expressible through this API, so a missing or ambiguous
 * accessible label becomes a real obstacle for the persona exactly as it is
 * for a person.
 *
 * Every action goes through the ProbeRecorder: budget check first, then the
 * candidate chain (primary affordance, then fallbacks if the persona's
 * patience allows), with hesitations and dead ends recorded as they happen.
 */
import type { Locator, Page } from 'playwright/test';
import { DeadEndError, ProbeRecorder } from './recorder';

/** What the persona is looking for, in perceptual terms. */
export type TargetSpec =
  | { role: string; name: string | RegExp; describe?: string }
  | { text: string | RegExp; describe?: string }
  | { label: string | RegExp; describe?: string }
  | { placeholder: string | RegExp; describe?: string };

export function describeTarget(spec: TargetSpec): string {
  if (spec.describe) return spec.describe;
  if ('role' in spec) return `${spec.role} "${String(spec.name)}"`;
  if ('text' in spec) return `text "${String(spec.text)}"`;
  if ('label' in spec) return `field labelled "${String(spec.label)}"`;
  return `field with placeholder "${String(spec.placeholder)}"`;
}

function locate(page: Page, spec: TargetSpec): Locator {
  if ('role' in spec) {
    // Playwright's role union is wider than worth re-typing here.
    return page.getByRole(spec.role as Parameters<Page['getByRole']>[0], {
      name: spec.name,
    });
  }
  if ('text' in spec) return page.getByText(spec.text);
  if ('label' in spec) return page.getByLabel(spec.label);
  return page.getByPlaceholder(spec.placeholder);
}

export class PersonaDriver {
  constructor(
    readonly page: Page,
    readonly recorder: ProbeRecorder,
  ) {}

  private get timeout(): number {
    return this.recorder.persona.actionTimeoutMs;
  }

  /** Navigate to an entry-point URL (counts against the action budget). */
  async goto(intent: string, path: string): Promise<void> {
    this.recorder.assertBudget();
    const start = Date.now();
    try {
      await this.page.goto(path, { timeout: this.timeout * 2 });
      this.recorder.record(intent, 'goto', path, 'ok', Date.now() - start);
    } catch (e) {
      this.recorder.record(intent, 'goto', path, 'failed', Date.now() - start);
      this.recorder.recordDeadEnd(intent, [path]);
      throw new DeadEndError(intent, [path]);
    }
  }

  /** Click an affordance; tries fallbacks if the persona's patience allows. */
  async click(intent: string, primary: TargetSpec, ...fallbacks: TargetSpec[]): Promise<void> {
    await this.attempt(intent, 'click', primary, fallbacks, (loc) =>
      loc.first().click({ timeout: this.timeout }),
    );
  }

  /** Fill a form field located by label/placeholder/role. */
  async fill(
    intent: string,
    value: string,
    primary: TargetSpec,
    ...fallbacks: TargetSpec[]
  ): Promise<void> {
    await this.attempt(intent, 'fill', primary, fallbacks, (loc) =>
      loc.first().fill(value, { timeout: this.timeout }),
    );
  }

  /**
   * Perception step: wait until something is visible. Does NOT consume the
   * action budget (looking is free) but is recorded, and slow appearance is a
   * hesitation point. Throws DeadEndError when nothing appears in time.
   */
  async see(intent: string, primary: TargetSpec, ...fallbacks: TargetSpec[]): Promise<void> {
    await this.attempt(
      intent,
      'expect',
      primary,
      fallbacks,
      (loc) => loc.first().waitFor({ state: 'visible', timeout: this.timeout }),
      // Perception never busts the action budget.
      { skipBudget: true },
    );
  }

  /** Browser back — how a user retreats from a screen with no obvious way
   * home. Counts as an action. */
  async back(intent: string): Promise<void> {
    this.recorder.assertBudget();
    const start = Date.now();
    await this.page.goBack({ timeout: this.timeout * 2 });
    this.recorder.record(intent, 'press', 'browser back', 'ok', Date.now() - start);
  }

  /**
   * Perception step with explicit extra patience, for waits where the UI
   * communicates progress (e.g. "making your book"). A user shown a clear
   * progress state waits longer than their usual per-action patience; the
   * extra wait is still recorded (and flagged as hesitation when slow).
   */
  async seeWithin(intent: string, spec: TargetSpec, patienceMs: number): Promise<void> {
    const target = describeTarget(spec);
    const start = Date.now();
    try {
      await locate(this.page, spec).first().waitFor({ state: 'visible', timeout: patienceMs });
      this.recorder.record(intent, 'expect', target, 'ok', Date.now() - start);
    } catch {
      this.recorder.record(intent, 'expect', target, 'failed', Date.now() - start);
      this.recorder.recordDeadEnd(intent, [target]);
      throw new DeadEndError(intent, [target]);
    }
  }

  /**
   * Perception race: wait until ONE of two things is visible and report which.
   * Used where the app may legitimately interpose a step (e.g. the PIN guard).
   * Free (perception); throws DeadEndError if neither appears in time.
   */
  async seeEither(intent: string, a: TargetSpec, b: TargetSpec): Promise<1 | 2> {
    const start = Date.now();
    const locA = locate(this.page, a).first();
    const locB = locate(this.page, b).first();
    try {
      await locA.or(locB).first().waitFor({ state: 'visible', timeout: this.timeout });
    } catch {
      const attempted = [describeTarget(a), describeTarget(b)];
      this.recorder.record(intent, 'expect', attempted.join(' OR '), 'failed', Date.now() - start);
      this.recorder.recordDeadEnd(intent, attempted);
      throw new DeadEndError(intent, attempted);
    }
    const which = (await locA.isVisible().catch(() => false)) ? 1 : 2;
    this.recorder.record(
      intent,
      'expect',
      describeTarget(which === 1 ? a : b),
      'ok',
      Date.now() - start,
    );
    return which;
  }

  /** True when the target is currently visible (free, recorded as perception). */
  async canSee(spec: TargetSpec, withinMs = 2_000): Promise<boolean> {
    const start = Date.now();
    try {
      await locate(this.page, spec).first().waitFor({ state: 'visible', timeout: withinMs });
      this.recorder.record('look around', 'expect', describeTarget(spec), 'ok', Date.now() - start);
      return true;
    } catch {
      this.recorder.record(
        'look around',
        'expect',
        describeTarget(spec),
        'failed',
        Date.now() - start,
        undefined,
        'not visible (non-fatal perception check)',
      );
      return false;
    }
  }

  private async attempt(
    intent: string,
    kind: 'click' | 'fill' | 'expect',
    primary: TargetSpec,
    fallbacks: TargetSpec[],
    run: (loc: Locator) => Promise<void>,
    opts: { skipBudget?: boolean } = {},
  ): Promise<void> {
    if (!opts.skipBudget) this.recorder.assertBudget();
    const candidates = this.recorder.persona.triesFallbacks
      ? [primary, ...fallbacks]
      : [primary];
    const attempted: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const spec = candidates[i];
      const target = describeTarget(spec);
      attempted.push(target);
      const start = Date.now();
      try {
        await run(locate(this.page, spec));
        this.recorder.record(
          intent,
          kind,
          target,
          i === 0 ? 'ok' : 'fallback',
          Date.now() - start,
          i + 1,
        );
        return;
      } catch {
        this.recorder.record(
          intent,
          kind,
          target,
          'failed',
          Date.now() - start,
          i + 1,
          i < candidates.length - 1 ? 'trying fallback' : 'no candidates left',
        );
      }
    }
    this.recorder.recordDeadEnd(intent, attempted);
    throw new DeadEndError(intent, attempted);
  }
}
