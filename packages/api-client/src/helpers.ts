/**
 * Helpers every client needs around the calls: idempotency keys, which errors
 * to retry, kid-safe words for errors, and display labels.
 */
import type { LikenessPart, OrderStatus, PartStatus, StoryStatus } from '@storypic/shared-types';
import { StoryPicApiError } from './http';

/** A fresh idempotency key: one per user action, repeated on a retry of that action. */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random()}${random()}`;
}

/**
 * One idempotency key per choice: asking again for the same choice (a double
 * tap, or a retry after a network error) gives the same key, so the server
 * returns the same result and charges once; a different choice gets a new key.
 */
export class ChoiceKeys {
  private last: { choice: string; key: string } | null = null;

  constructor(private readonly makeKey: () => string = newIdempotencyKey) {}

  keyFor(choice: string): string {
    if (this.last?.choice !== choice) this.last = { choice, key: this.makeKey() };
    return this.last.key;
  }
}

/** Errors a creation screen answers by waiting and sending the same request again. */
export function isRetryLater(error: unknown): boolean {
  return error instanceof StoryPicApiError && (error.code === 'TURN_IN_PROGRESS' || error.status === 503 || error.status === 0);
}

/**
 * Kid-safe words for a failed call. The server's messages for allowance and
 * unexpected input are already written for children; anything else becomes
 * friendly copy (raw errors stay in the console).
 */
export function kidSafeMessage(error: unknown): string {
  if (error instanceof StoryPicApiError) {
    switch (error.code) {
      case 'ENTITLEMENT_LIMIT':
      case 'INPUT_NOT_EXPECTED':
      case 'NETWORK':
        return error.message;
      case 'MODE_NOT_LIVE':
      case 'MODE_NOT_FOR_KIDS':
      case 'MODE_NOT_FOUND':
        return 'That way of making a story is resting right now. Pick another one!';
      case 'TURN_CONFLICT':
        return 'Another answer got there first. Here is the newest question!';
      case 'TURN_IN_PROGRESS':
      case 'AI_UNAVAILABLE':
      case 'AI_BAD_OUTPUT':
        return 'The storyteller needs a little breather. Let’s try again!';
      case 'STORY_NOT_CREATING':
        return 'This story is already finished!';
    }
    if (error.status === 503) return 'The storyteller needs a little breather. Let’s try again!';
  }
  return "Something went a little wonky! Don't worry — your ideas are safe. Let's try again.";
}

/** Kid-facing words for a Story's server status. */
export function storyStatusLabel(status: StoryStatus): string {
  switch (status) {
    case 'creating':
      return 'Still being made';
    case 'finishing':
      return 'Finishing touches…';
    case 'complete':
      return 'Story ready';
    case 'failed':
      return 'Got a bit stuck';
    case 'abandoned':
      return 'Stopped';
  }
}

/** True while any likeness part is still being made, so a page knows to keep refreshing. */
export function likenessBusy(person: { likenessStatus: Record<LikenessPart, PartStatus> }): boolean {
  return Object.values(person.likenessStatus).some((s) => s === 'working');
}

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amountMinor / 100);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  rendering: 'Preparing the print files',
  awaiting_payment: 'Waiting for payment',
  paid: 'Paid',
  awaiting_approval: 'Paid, being checked',
  submitting: 'Sending to the printer',
  submitted: 'With the printer',
  in_production: 'Being printed',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};
