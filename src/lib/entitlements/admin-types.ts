/** Shapes of /api/admin/allowances (src/server/entitlements/admin-allowances.ts), shared with the admin page. */
import type { EntitlementComponentKey } from '@/lib/types';

export type AllowanceRow = {
  component: EntitlementComponentKey;
  label: string;
  unit: string;
  meter: 'quota' | 'consumable';
  /** Quota: the allowance. Consumable: units ever granted. */
  total: number;
  used: number;
  remaining: number;
  /** False when this scope has no balance for the component yet. */
  present: boolean;
  reset?: string;
};

export type GrantRecordView = {
  id: string;
  at: string | null;
  source: string;
  by: string | null;
  scope: string;
  component: EntitlementComponentKey;
  mode: string;
  quantity: number;
  remainingBefore: number;
  remainingAfter: number;
  reason: string;
};

export type FamilyAllowances = {
  uid: string;
  email: string | null;
  /** False: the family has made nothing yet; the balances shown are the free tier it starts with. */
  ledgerExists: boolean;
  family: AllowanceRow[];
  children: Array<{ childId: string; displayName: string; rows: AllowanceRow[] }>;
  history: GrantRecordView[];
};

export type AllowanceAdjustment = {
  uid: string;
  /** Omit for the family pool. A child's own balance is used before the family pool. */
  childId?: string;
  component: EntitlementComponentKey;
  /** `add`: change what is available by `quantity` (may be negative). `setRemaining`: make exactly `quantity` available. */
  mode: 'add' | 'setRemaining';
  quantity: number;
  reason: string;
};
