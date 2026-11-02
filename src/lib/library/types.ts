/** GET /api/library/summary (src/server/library/summary.ts), shared with the clients. */
export type LibraryCounts = { stories: number; books: number };

export type LibrarySummary = {
  totals: LibraryCounts;
  /** Per child id; a child with nothing yet is absent (read it as zeros). */
  byChild: Record<string, LibraryCounts>;
};
