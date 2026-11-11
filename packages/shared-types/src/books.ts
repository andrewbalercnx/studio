// ============================================================================
// Books (read views — GET /api/books, GET /api/books/{bookId})
// ============================================================================

export type BookStatus = 'draft' | 'illustrating' | 'ready' | 'partial' | 'failed' | 'locked';

/** One Book in the family's library list (GET /api/books). */
export type BookListItem = {
  id: string;
  storyId: string;
  childId: string;
  styleId: string;
  status: BookStatus;
  title: string | null;
  art: { total: number; done: number; failed: number };
  /** Server-derived: the Book can be opened in the reader. */
  isReady: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

/** The making-of stage of a Book and how far through it is. */
export type BookProgressView = {
  stage: 'writing' | 'characters' | 'pages';
  done: number | null;
  total: number | null;
  percent: number;
};

/** One page of a Book read view, words and picture joined. */
export type BookReadPage = {
  pageNumber: number;
  kind: 'cover' | 'title' | 'story' | 'dedication' | 'end' | 'blank' | 'back';
  artUrl: string | null;
  text: string | null;
  narrationUrl: string | null;
  /** Shown in the on-screen reader (covers and story pages); title and end pages are for print. */
  inReader: boolean;
};

/** One Book in full (GET /api/books/{bookId}). */
export type BookReadView = {
  id: string;
  storyId: string;
  childId: string;
  styleId: string;
  layoutId: string | null;
  status: BookStatus;
  title: string | null;
  art: { total: number; done: number; failed: number };
  isReady: boolean;
  pages: BookReadPage[];
  progress: BookProgressView;
  createdAt: string | null;
  updatedAt: string | null;
};

/** POST /api/books. */
export type CreateBookRequest = {
  storyId: string;
  formId: string;
  styleId: string;
  /** One per user action (e.g. one "make my book" tap); a repeat returns the same Book, charged once. */
  idempotencyKey: string;
};

export type CreateBookResponse = { bookId: string; manuscriptId: string; status: BookStatus; created: boolean };

// ============================================================================
// Print (slice 5.5a): GET /api/books/{id}/print-options, …/renders
// ============================================================================

/** `books/{id}.print`: the print copies of a Book's pictures for its chosen template. */
export type BookPrintState = {
  layoutId: string;
  run: string;
  status: 'preparing' | 'ready' | 'partial' | 'failed';
  total: number;
  done: number;
  failed: number;
};

export type PrintOption = {
  layoutId: string;
  name: string;
  printProductId: string | null;
  trim: { widthIn: number; heightIn: number };
  leavesPerSpread: 1 | 2;
  interiorPages: number;
  price: { productId: string; priceId: string; currency: string; amountMinor: number } | null;
  isCurrent: boolean;
  /** The Book can be ordered in this template now: chosen, priced, print pictures ready. */
  orderable: boolean;
};

export type RenderView = {
  renderId: string;
  status: 'rendering' | 'ready' | 'failed';
  layoutId: string | null;
  interiorPages: number | null;
  spineWidthMm: number | null;
  files: Array<{ role: string; url: string | null; pageCount: number | null }>;
  error: string | null;
  createdAt: string | null;
};
