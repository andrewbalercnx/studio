/** Story and Book counts (`GET /api/library/summary`), counted on the server as the lists count them. */
export type LibraryCounts = { stories: number; books: number };

export type LibrarySummary = {
  totals: LibraryCounts;
  /** Per child id; a child with nothing yet is absent (zeros). */
  byChild: Record<string, LibraryCounts>;
};
