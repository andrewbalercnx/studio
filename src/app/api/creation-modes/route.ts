import { getCreationReadDb, listChoosableModes } from '@/server/creation';
import { withRoute } from '@/server/http';

/**
 * GET /api/creation-modes — the ways a child can make a story (slice 5.4):
 * live modes enabled for kids, in display order, presented kid-safely (no
 * model names), exactly one `recommended`. Replaces `/api/kids-generators`;
 * `modeId` is what `POST /api/stories` takes.
 * Response: `{ ok: true, data: { modes: CreationModeView[] } }`.
 */
export const GET = withRoute({ auth: 'user', name: 'creation-modes.list' }, async () => ({
  modes: await listChoosableModes(await getCreationReadDb()),
}));
