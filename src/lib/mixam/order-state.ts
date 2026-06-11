/**
 * Mixam order state → admin action mapping.
 *
 * Single source of truth for "what should the admin do next?" for a print order.
 * Used by:
 *  - the Mixam webhook handler (persists the action onto the order doc when status changes)
 *  - the admin print-orders list API (derives the action server-side for every order, so the
 *    list view shows current actions even for orders created before this field existed)
 *
 * Deliberately conservative: this module only DESCRIBES the next required action — it never
 * triggers Mixam operations. Auto-confirm / auto-cancel are explicitly out of scope; webhooks
 * update state and queue/flag actions for a human.
 */

/** Identifiers for admin next-actions. Stable strings — stored on order docs. */
export type AdminNextActionId =
  | 'review_approval' // Order awaiting admin review/approval
  | 'submit_to_mixam' // Approved order ready to submit
  | 'confirm_order' // Submitted to Mixam; quote needs confirming
  | 'fix_artwork' // Mixam reported artwork/validation errors
  | 'investigate_hold' // Order on hold at Mixam — find out why
  | 'investigate_failure' // Order in failed state
  | 'monitor' // Nothing actionable — system/Mixam is working
  | 'none'; // Terminal or parent-side state — no admin action

export type AdminNextAction = {
  action: AdminNextActionId;
  /** Human-readable instruction shown as a chip/tooltip in admin views. */
  label: string;
  /** True when the order is blocked on an admin decision (drives "needs attention" UI). */
  urgent: boolean;
};

export type DeriveAdminNextActionInput = {
  /** PrintOrder.fulfillmentStatus (MixamOrderStatus) — accepts string for forward compat. */
  fulfillmentStatus: string;
  /** True when Mixam flagged artwork errors (webhook hasErrors / stored mixamHasErrors). */
  hasArtworkErrors?: boolean;
  /** Mixam's stated reason for the current status (e.g. why on hold). */
  statusReason?: string | null;
};

/**
 * Map an order's current state to the next required admin action.
 * Pure function — unit tested in src/lib/mixam/__tests__/order-state.test.ts.
 */
export function deriveAdminNextAction(input: DeriveAdminNextActionInput): AdminNextAction {
  const status = (input.fulfillmentStatus || '').toLowerCase();

  // Artwork errors override the status mapping for any non-terminal state: whatever Mixam says
  // the status is, the admin's job is to fix the artwork first.
  const terminal = status === 'delivered' || status === 'cancelled';
  if (input.hasArtworkErrors && !terminal) {
    return {
      action: 'fix_artwork',
      label: 'Review artwork errors and re-upload corrected files',
      urgent: true,
    };
  }

  switch (status) {
    case 'draft':
      return { action: 'none', label: 'Parent has not completed checkout', urgent: false };
    case 'validating':
      return { action: 'monitor', label: 'Pre-submission validation running', urgent: false };
    case 'validation_failed':
      return {
        action: 'fix_artwork',
        label: 'Fix validation errors before this order can proceed',
        urgent: true,
      };
    case 'ready_to_submit':
    case 'awaiting_approval':
      return { action: 'review_approval', label: 'Review and approve this order', urgent: true };
    case 'approved':
      return { action: 'submit_to_mixam', label: 'Submit the approved order to Mixam', urgent: true };
    case 'submitting':
      return { action: 'monitor', label: 'Submission to Mixam in progress', urgent: false };
    case 'submitted':
      return {
        action: 'confirm_order',
        label: 'Confirm the order with Mixam (review quote and confirm)',
        urgent: true,
      };
    case 'confirmed':
      return { action: 'monitor', label: 'Confirmed — awaiting production start', urgent: false };
    case 'in_production':
      return { action: 'monitor', label: 'In production at Mixam', urgent: false };
    case 'on_hold':
      return {
        action: 'investigate_hold',
        label: input.statusReason
          ? `Order on hold: ${input.statusReason}`
          : 'Order on hold at Mixam — investigate the reason',
        urgent: true,
      };
    case 'shipped':
      return { action: 'monitor', label: 'Shipped — monitor delivery', urgent: false };
    case 'delivered':
      return { action: 'none', label: 'Delivered — no action required', urgent: false };
    case 'cancelled':
      return { action: 'none', label: 'Cancelled — no action required', urgent: false };
    case 'failed':
      return {
        action: 'investigate_failure',
        label: 'Order failed — investigate the process log',
        urgent: true,
      };
    default:
      return { action: 'monitor', label: `Unknown status "${status}" — monitor`, urgent: false };
  }
}

export type FailureSummaryInput = {
  fulfillmentStatus?: string;
  validationResult?: { valid: boolean; errors?: string[] } | null;
  mixamArtworkErrors?: Array<{ page?: number; message?: string }> | null;
  mixamStatusReason?: string | null;
  rejectedReason?: string | null;
  fulfillmentNotes?: string | null;
};

const MAX_SUMMARY_LENGTH = 200;

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_SUMMARY_LENGTH ? `${trimmed.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : trimmed;
}

/**
 * Produce a one-line failure summary for an order, or null when there is nothing to surface.
 * Priority: artwork errors > validation errors > rejection > Mixam status reason >
 * fulfilment notes (only for problem states — notes on healthy orders are routine).
 */
export function buildFailureSummary(order: FailureSummaryInput): string | null {
  if (order.mixamArtworkErrors && order.mixamArtworkErrors.length > 0) {
    const first = order.mixamArtworkErrors[0];
    const firstMessage = first?.message || 'unspecified error';
    const pagePrefix = first?.page !== undefined ? `Page ${first.page}: ` : '';
    const more = order.mixamArtworkErrors.length > 1 ? ` (+${order.mixamArtworkErrors.length - 1} more)` : '';
    return truncate(`Artwork: ${pagePrefix}${firstMessage}${more}`);
  }

  if (order.validationResult && order.validationResult.valid === false) {
    const errors = order.validationResult.errors ?? [];
    const first = errors[0] || 'unspecified validation error';
    const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : '';
    return truncate(`Validation: ${first}${more}`);
  }

  if (order.rejectedReason) {
    return truncate(`Rejected: ${order.rejectedReason}`);
  }

  if (order.mixamStatusReason) {
    return truncate(`Mixam: ${order.mixamStatusReason}`);
  }

  const problemStates = ['on_hold', 'failed', 'validation_failed', 'cancelled'];
  const status = (order.fulfillmentStatus || '').toLowerCase();
  if (order.fulfillmentNotes && problemStates.includes(status)) {
    return truncate(order.fulfillmentNotes);
  }

  return null;
}
