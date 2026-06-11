/**
 * Order transparency config (Sprint W3-C).
 *
 * Reads `systemConfig/orderTransparency` — the parent-facing turnaround
 * estimate surfaced on order confirmation and the orders page. Follows the
 * standard systemConfig pattern (60s in-memory cache, code defaults when the
 * doc is missing) so admins can tune the estimate without a deploy.
 */
import { getServerFirestore } from '@/lib/server-firestore';
import type { OrderTransparencyConfig } from '@/lib/types';

export const DEFAULT_ORDER_TRANSPARENCY_CONFIG: OrderTransparencyConfig = {
  turnaroundMinBusinessDays: 10,
  turnaroundMaxBusinessDays: 15,
};

let cachedConfig: OrderTransparencyConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000;

export async function getOrderTransparencyConfig(): Promise<OrderTransparencyConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }
  try {
    const firestore = await getServerFirestore();
    const doc = await firestore.doc('systemConfig/orderTransparency').get();
    const data = doc.exists ? (doc.data() as Partial<OrderTransparencyConfig>) : {};
    cachedConfig = { ...DEFAULT_ORDER_TRANSPARENCY_CONFIG, ...data };
  } catch (error: any) {
    // Estimates are informational — never fail an orders request over config.
    console.warn('[order-transparency-config] Falling back to defaults:', error?.message);
    cachedConfig = { ...DEFAULT_ORDER_TRANSPARENCY_CONFIG };
  }
  cacheTimestamp = now;
  return cachedConfig;
}

export function clearOrderTransparencyConfigCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}
