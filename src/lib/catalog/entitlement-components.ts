/**
 * Code-defined entitlement components — the grantable building blocks a product manager assembles
 * products from. Fixed in code because each needs enforcement logic; the *combinations* (products)
 * are unlimited and admin-driven. See docs/PRODUCTS.md.
 */
import type { EntitlementComponentDef, EntitlementComponentKey } from '@/lib/types';

export const ENTITLEMENT_COMPONENTS: Record<EntitlementComponentKey, EntitlementComponentDef> = {
  print_credit: {
    key: 'print_credit',
    label: 'Print credit',
    description: 'Allows printing one physical book (decrements on print).',
    meter: 'consumable',
    unit: 'books',
    defaultScope: 'family',
  },
  story_allowance: {
    key: 'story_allowance',
    label: 'Story allowance',
    description: 'How many stories can be created.',
    meter: 'quota',
    unit: 'stories',
    defaultScope: 'family',
  },
  storybook_allowance: {
    key: 'storybook_allowance',
    label: 'Storybook allowance',
    description: 'How many storybooks can be generated.',
    meter: 'quota',
    unit: 'storybooks',
    defaultScope: 'family',
  },
};

export const ENTITLEMENT_COMPONENT_LIST: EntitlementComponentDef[] = Object.values(ENTITLEMENT_COMPONENTS);

export function isEntitlementComponentKey(key: string): key is EntitlementComponentKey {
  return key in ENTITLEMENT_COMPONENTS;
}
