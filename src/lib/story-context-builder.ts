import type { ChildProfile, Character } from '@/lib/types';
import { getServerFirestore } from '@/lib/server-firestore';

export type StoryContextData = {
  mainChild: ChildProfile | null;
  siblings: ChildProfile[];
  mainCharacter: Character | null;
  characters: Character[];
  childAge: number | null;
};

export type FormattedStoryContext = {
  childContext: string;
  siblingsContext: string;
  charactersContext: string;
  fullContext: string;
  newlyIntroducedCharactersContext: string; // Characters introduced during this story session
};

function calculateChildAge(child: ChildProfile | null): number | null {
  if (!child?.dateOfBirth) return null;
  let dob: Date | null = null;
  if (typeof child.dateOfBirth?.toDate === 'function') {
    dob = child.dateOfBirth.toDate();
  } else {
    const parsed = new Date(child.dateOfBirth);
    dob = isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function formatDate(dateOfBirth: any): string {
  if (!dateOfBirth) return 'Unknown';
  if (typeof dateOfBirth?.toDate === 'function') {
    return dateOfBirth.toDate().toISOString().split('T')[0];
  }
  if (typeof dateOfBirth === 'string') {
    return new Date(dateOfBirth).toISOString().split('T')[0];
  }
  if (dateOfBirth instanceof Date) {
    return dateOfBirth.toISOString().split('T')[0];
  }
  return 'Unknown';
}

function formatChildProfile(child: ChildProfile, age: number | null, isMain: boolean = false): string {
  const label = isMain ? '**MAIN CHILD**' : 'Sibling';
  const ageStr = age ? `${age} years old` : 'Age unknown';
  const dob = formatDate(child.dateOfBirth);
  const pronouns = child.pronouns ? `\n  Pronouns: ${child.pronouns}` : '\n  Pronouns: they/them (default)';
  const description = child.description ? `\n  Description: ${child.description}` : '';
  const likes = child.likes?.length ? `\n  Likes: ${child.likes.join(', ')}` : '';
  const dislikes = child.dislikes?.length ? `\n  Dislikes: ${child.dislikes.join(', ')}` : '';

  // Use placeholder format: $$id$$ - in generated text, ONLY use $$${child.id}$$ (never the display name)
  return `- ${label}: $$${child.id}$$ (display name: "${child.displayName}")
  Age: ${ageStr} (Born: ${dob})${pronouns}${description}${likes}${dislikes}`;
}

function formatCharacter(character: Character, isMain: boolean = false): string {
  const label = isMain ? '**MAIN CHARACTER (CHILD)**' : 'Supporting Character';
  const age = character.dateOfBirth ? calculateChildAge({ dateOfBirth: character.dateOfBirth } as ChildProfile) : null;
  const ageStr = age ? `${age} years old` : 'Age unknown';
  const dob = formatDate(character.dateOfBirth);
  const pronouns = character.pronouns ? `\n  Pronouns: ${character.pronouns}` : '\n  Pronouns: they/them (default)';
  const description = character.description ? `\n  Description: ${character.description}` : '';
  const likes = character.likes?.length ? `\n  Likes: ${character.likes.join(', ')}` : '';
  const dislikes = character.dislikes?.length ? `\n  Dislikes: ${character.dislikes.join(', ')}` : '';
  const childSpecific = character.childId ? ' [Child-specific]' : ' [Family-wide]';

  // Use placeholder format: $$id$$ - in generated text, ONLY use $$${character.id}$$ (never the display name)
  return `- ${label}: $$${character.id}$$ (display name: "${character.displayName}", type: ${character.type})${childSpecific}
  Age: ${ageStr} (Born: ${dob})${pronouns}${description}${likes}${dislikes}`;
}

/**
 * Loads and formats consistent story context for all story flows
 * @param supportingCharacterIds - Character IDs introduced during this story session (optional)
 */
export async function buildStoryContext(
  parentUid: string,
  childId: string | null | undefined,
  mainCharacterId: string | null | undefined,
  supportingCharacterIds?: string[]
): Promise<{ data: StoryContextData; formatted: FormattedStoryContext }> {
  const firestore = await getServerFirestore();

  // 1. Load main child profile
  let mainChild: ChildProfile | null = null;
  if (childId) {
    const childDoc = await firestore.collection('children').doc(childId).get();
    if (childDoc.exists) {
      mainChild = { ...childDoc.data(), id: childDoc.id } as ChildProfile;
    }
  }
  const childAge = calculateChildAge(mainChild);

  // 2. Load siblings (other children of the same parent)
  const siblingsSnapshot = await firestore
    .collection('children')
    .where('ownerParentUid', '==', parentUid)
    .limit(10)
    .get();
  const siblings = siblingsSnapshot.docs
    .map(doc => ({ ...doc.data(), id: doc.id } as ChildProfile))
    .filter(child => child.id !== childId); // Exclude the main child

  // 3. Load main character (deprecated - child should be referenced directly)
  // This is kept for backward compatibility with existing sessions
  let mainCharacter: Character | null = null;
  if (mainCharacterId) {
    const charDoc = await firestore.collection('characters').doc(mainCharacterId).get();
    if (charDoc.exists) {
      mainCharacter = { ...charDoc.data(), id: charDoc.id } as Character;
    }
  }

  // 4. Load all characters for this parent (supporting characters only)
  const charactersSnapshot = await firestore
    .collection('characters')
    .where('ownerParentUid', '==', parentUid)
    .limit(20)
    .get();
  const characters = charactersSnapshot.docs
    .map(doc => ({ ...doc.data(), id: doc.id } as Character))
    .filter(char => char.id !== mainCharacterId); // Exclude main character if it exists

  // 5. Format the context
  const childContext = mainChild
    ? formatChildProfile(mainChild, childAge, true)
    : '- No main child profile available';

  const siblingsContext = siblings.length > 0
    ? siblings.map(sibling => {
        const siblingAge = calculateChildAge(sibling);
        return formatChildProfile(sibling, siblingAge, false);
      }).join('\n')
    : '- No siblings';

  // Only show mainCharacter if it exists (backward compatibility)
  const mainCharDesc = mainCharacter
    ? formatCharacter(mainCharacter, true)
    : '';

  const otherCharsDesc = characters.length > 0
    ? characters.map(char => formatCharacter(char, false)).join('\n')
    : '';

  const charactersContext = [mainCharDesc, otherCharsDesc]
    .filter(s => s)
    .join('\n');

  // 6. Identify newly introduced characters (characters added during this story session)
  const supportingCharacterIdSet = new Set(supportingCharacterIds || []);
  const newlyIntroducedCharacters = characters.filter(char => supportingCharacterIdSet.has(char.id));

  const newlyIntroducedCharactersContext = newlyIntroducedCharacters.length > 0
    ? newlyIntroducedCharacters.map(char => {
        const pronouns = char.pronouns || 'they/them';
        return `- $$${char.id}$$ ("${char.displayName}"): ${char.description || char.type} - uses ${pronouns} pronouns`;
      }).join('\n')
    : '';

  const fullContext = `
**CHILD PROFILE (Main Subject of Story):**
${childContext}

**SIBLINGS:**
${siblingsContext}

**SUPPORTING CHARACTERS:**
${charactersContext || '- No supporting characters created yet'}
  `.trim();

  return {
    data: {
      mainChild,
      siblings,
      mainCharacter,
      characters,
      childAge,
    },
    formatted: {
      childContext,
      siblingsContext,
      charactersContext,
      fullContext,
      newlyIntroducedCharactersContext,
    },
  };
}

/**
 * Actor info type used for building actor lists
 */
export type ActorInfo = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  pronouns?: string;
  type: 'child' | 'sibling' | 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
  relationship?: string; // For Family type characters
  description?: string;
  likes?: string[];
  dislikes?: string[];
  isMainChild: boolean;
};

/**
 * Builds a detailed text description for a single actor
 * Used in prompts that don't include images
 * Accepts ActorInfo, ActorDetails, or ActorDetailsWithImages
 */
export function buildActorDescription(actor: ActorInfo | ActorDetails | ActorDetailsWithImages): string {
  const parts: string[] = [];

  // Name and role
  if (actor.isMainChild) {
    parts.push(`${actor.displayName} - the main child character`);
  } else if (actor.type === 'sibling') {
    parts.push(`${actor.displayName} - a sibling`);
  } else if (actor.type === 'Family' && actor.relationship) {
    parts.push(`${actor.displayName} - ${actor.relationship}`);
  } else {
    parts.push(`${actor.displayName} - ${actor.type}`);
  }

  // Pronouns
  if (actor.pronouns) {
    parts.push(`Uses ${actor.pronouns} pronouns`);
  }

  // Description
  if (actor.description) {
    parts.push(actor.description);
  }

  // Likes/dislikes
  if (actor.likes && actor.likes.length > 0) {
    parts.push(`Likes: ${actor.likes.join(', ')}`);
  }
  if (actor.dislikes && actor.dislikes.length > 0) {
    parts.push(`Dislikes: ${actor.dislikes.join(', ')}`);
  }

  return parts.join('. ') + '.';
}

/**
 * Builds a short description for an actor (for image prompts with references)
 */
export function buildActorShortDescription(actor: ActorInfo): string {
  if (actor.isMainChild) {
    return `${actor.displayName} (the main child character)`;
  } else if (actor.type === 'sibling') {
    return `${actor.displayName} (sibling)`;
  } else if (actor.type === 'Family' && actor.relationship) {
    return `${actor.displayName} (${actor.relationship})`;
  } else {
    const desc = actor.description || actor.likes?.slice(0, 2).join(', ') || '';
    return `${actor.displayName} (${actor.type}${desc ? `: ${desc}` : ''})`;
  }
}

/**
 * Converts a ChildProfile to ActorInfo
 */
export function childProfileToActorInfo(
  child: ChildProfile,
  isMainChild: boolean = false
): ActorInfo {
  return {
    id: child.id,
    displayName: child.displayName,
    avatarUrl: child.avatarUrl,
    pronouns: child.pronouns,
    type: isMainChild ? 'child' : 'sibling',
    description: child.description,
    likes: child.likes,
    dislikes: child.dislikes,
    isMainChild,
  };
}

/**
 * Converts a Character to ActorInfo
 */
export function characterToActorInfo(character: Character): ActorInfo {
  return {
    id: character.id,
    displayName: character.displayName,
    avatarUrl: character.avatarUrl,
    pronouns: character.pronouns,
    type: character.type,
    relationship: character.relationship,
    description: character.description,
    likes: character.likes,
    dislikes: character.dislikes,
    isMainChild: false,
  };
}

/**
 * Builds a full actor list with detailed descriptions (no images)
 * Used for text-based prompts like synopsis generation
 */
export function buildActorListForPrompt(actors: ActorInfo[]): string {
  if (actors.length === 0) {
    return 'No actors found.';
  }

  return actors.map((actor, index) => {
    const num = index + 1;
    const desc = buildActorDescription(actor);
    return `${num}. ${desc}`;
  }).join('\n');
}

/**
 * Builds an actor list with image references for image generation prompts
 * Indicates which actors have reference images available
 */
export function buildActorListWithImageInfo(actors: ActorInfo[]): string {
  if (actors.length === 0) {
    return 'No actors found.';
  }

  return actors.map((actor, index) => {
    const num = index + 1;
    const shortDesc = buildActorShortDescription(actor);
    const hasImage = actor.avatarUrl ? ' [has reference image]' : ' [no reference image]';
    return `${num}. ${shortDesc}${hasImage}`;
  }).join('\n');
}

// ============================================================================
// Actor Details Types and Functions
// ============================================================================

/**
 * Type for actor details without images - used for text-based prompts
 */
export type ActorDetails = {
  id: string;
  displayName: string;
  pronouns?: string;
  type: 'child' | 'sibling' | 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
  relationship?: string;
  description?: string;
  likes?: string[];
  dislikes?: string[];
  isMainChild: boolean;
};

/**
 * Type for actor details with image URLs
 */
export type ActorDetailsWithImages = ActorDetails & {
  avatarUrl?: string;
  photos?: string[];
};

/**
 * Type for actor details with image data URIs (for AI prompts)
 */
export type ActorDetailsWithImageData = ActorDetailsWithImages & {
  avatarDataUri?: string;
};

/**
 * Extract $$id$$ placeholders from text
 */
export function extractActorIdsFromText(text: string): string[] {
  const regex = /\$\$([a-zA-Z0-9_-]+)\$\$/g;
  const ids = new Set<string>();
  let match;
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

/**
 * Convert ActorInfo to ActorDetails object (excludes image fields)
 */
function buildActorDetailsObject(actor: ActorInfo): ActorDetails {
  return {
    id: actor.id,
    displayName: actor.displayName,
    pronouns: actor.pronouns,
    type: actor.type,
    relationship: actor.relationship,
    description: actor.description,
    likes: actor.likes,
    dislikes: actor.dislikes,
    isMainChild: actor.isMainChild,
  };
}

/**
 * Convert ActorInfo + entity to ActorDetailsWithImages object
 */
function buildActorDetailsWithImagesObject(
  actor: ActorInfo,
  entity: ChildProfile | Character
): ActorDetailsWithImages {
  return {
    ...buildActorDetailsObject(actor),
    avatarUrl: entity.avatarUrl,
    photos: entity.photos,
  };
}

/**
 * Convert single actor to JSON string (no images)
 */
export function actorDetails(actor: ActorInfo): string {
  return JSON.stringify(buildActorDetailsObject(actor), null, 2);
}

/**
 * Convert single actor to JSON string (with image URLs)
 */
export function actorDetailsWithImages(
  actor: ActorInfo,
  entity: ChildProfile | Character
): string {
  return JSON.stringify(buildActorDetailsWithImagesObject(actor, entity), null, 2);
}

/**
 * Internal helper to load actors from Firestore by IDs
 * Returns array with both ActorInfo and original entity for flexibility
 */
async function loadActorsFromIds(
  firestore: FirebaseFirestore.Firestore,
  actorList: string[],
  mainChildId?: string
): Promise<Array<{ actorInfo: ActorInfo; entity: ChildProfile | Character }>> {
  if (!actorList || actorList.length === 0) return [];

  // Load from both children and characters collections in parallel
  const [childDocs, characterDocs] = await Promise.all([
    Promise.all(actorList.map(id => firestore.collection('children').doc(id).get())),
    Promise.all(actorList.map(id => firestore.collection('characters').doc(id).get())),
  ]);

  // Build maps
  const childMap = new Map<string, ChildProfile>();
  childDocs.forEach(doc => {
    if (doc.exists) {
      childMap.set(doc.id, { id: doc.id, ...doc.data() } as ChildProfile);
    }
  });

  const characterMap = new Map<string, Character>();
  characterDocs.forEach(doc => {
    if (doc.exists) {
      characterMap.set(doc.id, { id: doc.id, ...doc.data() } as Character);
    }
  });

  // Build result array in order, with main child first if specified
  const result: Array<{ actorInfo: ActorInfo; entity: ChildProfile | Character }> = [];
  const processedIds = new Set<string>();

  // Add main child first if specified and in the list
  if (mainChildId && childMap.has(mainChildId)) {
    const child = childMap.get(mainChildId)!;
    result.push({
      actorInfo: childProfileToActorInfo(child, true),
      entity: child,
    });
    processedIds.add(mainChildId);
  }

  // Add remaining actors in order
  for (const id of actorList) {
    if (processedIds.has(id)) continue;

    const child = childMap.get(id);
    if (child) {
      result.push({
        actorInfo: childProfileToActorInfo(child, false),
        entity: child,
      });
      processedIds.add(id);
      continue;
    }

    const character = characterMap.get(id);
    if (character) {
      result.push({
        actorInfo: characterToActorInfo(character),
        entity: character,
      });
      processedIds.add(id);
    }
  }

  return result;
}

/**
 * Load actors from Firestore and return JSON string (no images)
 */
export async function getActorsDetails(
  firestore: FirebaseFirestore.Firestore,
  actorList: string[],
  mainChildId?: string
): Promise<string> {
  const actors = await loadActorsFromIds(firestore, actorList, mainChildId);
  const details = actors.map(a => buildActorDetailsObject(a.actorInfo));
  return JSON.stringify(details, null, 2);
}

/**
 * Load actors from Firestore and return JSON string (with image URLs)
 */
export async function getActorsDetailsWithImages(
  firestore: FirebaseFirestore.Firestore,
  actorList: string[],
  mainChildId?: string
): Promise<string> {
  const actors = await loadActorsFromIds(firestore, actorList, mainChildId);
  const details = actors.map(a => buildActorDetailsWithImagesObject(a.actorInfo, a.entity));
  return JSON.stringify(details, null, 2);
}

/**
 * Fetch image as data URI (base64)
 */
async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Load actors with image data URIs for AI image generation
 * Returns array (not JSON) because image generation flows need to access individual images
 */
export async function getActorsDetailsWithImageData(
  firestore: FirebaseFirestore.Firestore,
  actorList: string[],
  mainChildId?: string
): Promise<ActorDetailsWithImageData[]> {
  const actors = await loadActorsFromIds(firestore, actorList, mainChildId);

  // Fetch avatar images in parallel
  const results = await Promise.all(
    actors.map(async ({ actorInfo, entity }) => {
      const details = buildActorDetailsWithImagesObject(actorInfo, entity);
      const avatarDataUri = entity.avatarUrl
        ? await fetchImageAsDataUri(entity.avatarUrl)
        : null;

      return {
        ...details,
        avatarDataUri: avatarDataUri || undefined,
      } as ActorDetailsWithImageData;
    })
  );

  return results;
}
