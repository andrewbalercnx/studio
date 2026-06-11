/**
 * Step/funnel/finding recorder for one probe goal run.
 *
 * Counts budget-consuming actions (goto/click/fill/press), records every step
 * with timing, flags hesitations (fallback used, or action slower than the
 * persona's threshold) and dead ends, and enforces the persona's budgets.
 */
import type {
  ActionKind,
  ActionOutcome,
  DeadEnd,
  Finding,
  FunnelStepName,
  FunnelStepResult,
  GoalScore,
  Hesitation,
  Persona,
  ProbeStep,
  RunFragment,
} from './types';

export class BudgetExceededError extends Error {
  constructor(public readonly reason: string) {
    super(`persona budget exceeded: ${reason}`);
    this.name = 'BudgetExceededError';
  }
}

export class DeadEndError extends Error {
  constructor(public readonly intent: string, public readonly attempted: string[]) {
    super(`dead end: no affordance worked for "${intent}" (tried: ${attempted.join(' | ')})`);
    this.name = 'DeadEndError';
  }
}

const BUDGETED_KINDS: ActionKind[] = ['goto', 'click', 'fill', 'press'];

export class ProbeRecorder {
  readonly steps: ProbeStep[] = [];
  readonly funnel: FunnelStepResult[] = [];
  readonly hesitations: Hesitation[] = [];
  readonly deadEnds: DeadEnd[] = [];
  readonly findings: Finding[] = [];
  readonly startedAt = new Date();
  private actionsTaken = 0;
  private stepCounter = 0;
  private failureReason: string | undefined;

  constructor(readonly persona: Persona) {}

  get actionCount(): number {
    return this.actionsTaken;
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt.getTime();
  }

  /** Throws BudgetExceededError when the next action would bust a budget. */
  assertBudget(): void {
    if (this.actionsTaken >= this.persona.budgets.maxActions) {
      throw new BudgetExceededError(
        `max actions (${this.persona.budgets.maxActions}) reached`,
      );
    }
    if (this.elapsedMs() >= this.persona.budgets.maxWallMs) {
      throw new BudgetExceededError(
        `max wall-clock (${this.persona.budgets.maxWallMs}ms) reached after ${this.actionsTaken} actions`,
      );
    }
  }

  record(
    intent: string,
    kind: ActionKind,
    target: string,
    outcome: ActionOutcome,
    durationMs: number,
    candidateUsed?: number,
    note?: string,
  ): ProbeStep {
    const step: ProbeStep = {
      n: ++this.stepCounter,
      intent,
      kind,
      target,
      outcome,
      durationMs: Math.round(durationMs),
      ...(candidateUsed !== undefined && candidateUsed > 1 ? { candidateUsed } : {}),
      ...(note ? { note } : {}),
    };
    this.steps.push(step);
    if (BUDGETED_KINDS.includes(kind) && outcome !== 'failed') {
      this.actionsTaken += 1;
    }
    if (outcome === 'fallback') {
      this.hesitations.push({
        atStep: step.n,
        intent,
        reason: 'fallback-used',
        detail: `primary affordance missing; used candidate ${candidateUsed}: ${target}`,
      });
    } else if (outcome === 'ok' && durationMs > this.persona.hesitationThresholdMs) {
      this.hesitations.push({
        atStep: step.n,
        intent,
        reason: 'slow-action',
        detail: `${target} took ${Math.round(durationMs)}ms (> ${this.persona.hesitationThresholdMs}ms threshold)`,
      });
    }
    return step;
  }

  recordDeadEnd(intent: string, attempted: string[]): void {
    this.deadEnds.push({ atStep: this.stepCounter, intent, attempted });
  }

  markFunnelStep(step: FunnelStepName, opts: { simulated?: boolean } = {}): void {
    this.funnel.push({
      step,
      reached: true,
      atAction: this.actionsTaken,
      elapsedMs: this.elapsedMs(),
      ...(opts.simulated ? { simulated: true } : {}),
    });
  }

  markFunnelStepMissed(step: FunnelStepName): void {
    this.funnel.push({ step, reached: false });
  }

  addFinding(finding: Finding): void {
    this.findings.push(finding);
  }

  fail(reason: string): void {
    this.failureReason = reason;
  }

  score(success: boolean): GoalScore {
    return {
      actionsTaken: this.actionsTaken,
      wallMs: this.elapsedMs(),
      success,
      ...(this.failureReason ? { failureReason: this.failureReason } : {}),
    };
  }

  fragment(
    base: Pick<RunFragment, 'runId' | 'kind' | 'project' | 'goal'> &
      Partial<Pick<RunFragment, 'persona' | 'check' | 'checkTitle' | 'verdict'>>,
    success: boolean,
  ): RunFragment {
    return {
      schemaVersion: 1,
      ...base,
      startedAt: this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      steps: this.steps,
      funnel: this.funnel,
      hesitations: this.hesitations,
      deadEnds: this.deadEnds,
      findings: this.findings,
      score: this.score(success),
    };
  }
}
