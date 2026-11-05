// ============================================================================
// Children and Characters (slice 5.7): /api/children/**, /api/characters/**
// ============================================================================

export type PersonKind = 'child' | 'character';
export type LikenessPart = 'describe' | 'portrait' | 'avatar' | 'animate';
export type PartStatus = 'idle' | 'working' | 'failed';
export type AvatarSource = 'portrait' | 'description' | 'photo';

/** Photos, appearance and portrait are the likeness (from the photos only); the avatar is UI only. */
export type Likeness = {
  photos: string[];
  appearance: string | null;
  portrait: string | null;
  avatar: string | null;
  avatarSource: AvatarSource | null;
  avatarAnimation: string | null;
};

type PersonBase = {
  id: string;
  ownerUid: string;
  displayName: string;
  namePronunciation: string | null;
  pronouns: string | null;
  description: string | null;
  likes: string[];
  dislikes: string[];
  /** `YYYY-MM-DD` or null. */
  dateOfBirth: string | null;
  likeness: Likeness;
  /** The avatar was drawn from the words, not a photo: show it as "imagined". */
  avatarImagined: boolean;
  /** Each likeness part's progress, shown separately. */
  likenessStatus: Record<LikenessPart, PartStatus>;
  photoIds: Array<{ id: string; url: string }>;
};

export type ChildView = PersonBase & { kind: 'child'; preferredVoiceId: string | null; autoReadAloud: boolean };
export type CharacterView = PersonBase & {
  kind: 'character';
  type: string | null;
  relationship: string | null;
  childId: string | null;
  origin: 'parent' | 'story';
  usageCount: number;
};
export type PersonView = ChildView | CharacterView;

/**
 * One child as bare `GET /api/children[/{id}]` answers it (the mobile shape):
 * the stored fields plus the normalised `likeness`. `avatarUrl` is the old
 * field, still written by the server until slice 6.3.
 */
export type ChildRecord = {
  id: string;
  displayName: string;
  likeness: Likeness;
  avatarUrl?: string;
  preferredVoiceId?: string;
  autoReadAloud?: boolean;
  [field: string]: unknown;
};

export type ProfileInput = {
  displayName: string;
  namePronunciation: string | null;
  pronouns: string | null;
  description: string | null;
  likes: string[];
  dislikes: string[];
  dateOfBirth: string | null;
};
export type ChildProfileInput = ProfileInput & { preferredVoiceId?: string | null; autoReadAloud?: boolean };
export type CharacterProfileInput = ProfileInput & { type: string | null; relationship: string | null; childId: string | null };
