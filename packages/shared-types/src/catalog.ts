/** The Forms (story output types) and art Styles a Book can be made in. */

// ============================================================================
// Story Output Type and Image Style Types
// ============================================================================

/**
 * Story output type (e.g., picture book, poem).
 * Stored at: storyOutputTypes/{outputTypeId}
 */
export type StoryOutputType = {
  id: string;
  name: string;
  status: 'live' | 'draft' | 'archived';
  ageRange: string;
  shortDescription: string;
  childFacingLabel: string;
  category: 'picture_book' | 'poem' | 'coloring_pages' | 'audio_script';
  defaultPrintLayoutId?: string;
  imageUrl?: string;
  layoutHints?: {
    pageCount?: number;
    needsImages?: boolean;
    preferredAspectRatio?: 'landscape' | 'portrait' | 'square';
    textDensity?: 'very_low' | 'low' | 'medium';
  };
  tags: string[];
};

/**
 * Image style for storybook illustrations.
 * Stored at: imageStyles/{styleId}
 */
export type ImageStyle = {
  id: string;
  title: string;
  description: string;
  ageRange: string;
  ageFrom?: number | null;
  ageTo?: number | null;
  stylePrompt: string;
  sampleDescription: string;
  sampleImageUrl?: string | null;
  preferred?: boolean;
};

/** A Form as the chooser shows it (`GET /api/storyOutputTypes`). */
export type FormOption = Pick<StoryOutputType, 'id'> & Partial<Pick<StoryOutputType, 'name' | 'childFacingLabel' | 'shortDescription'>>;

/** An art Style as the chooser shows it (`GET /api/imageStyles`). */
export type StyleOption = Pick<ImageStyle, 'id'> & Partial<Pick<ImageStyle, 'title' | 'sampleImageUrl' | 'ageFrom' | 'ageTo'>>;
