/**
 * For admin tools that read stored `children` / `characters` documents
 * directly (admins may; parents read through the API): the owner and avatar.
 * Slice 6.3 dropped the old field names, so these read only `ownerUid` and
 * `likeness.avatar`.
 */
type Stored = { ownerUid?: unknown; likeness?: { avatar?: unknown } | null };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export function storedOwner(doc: Stored): string | null {
  return text(doc.ownerUid);
}

export function storedAvatar(doc: Stored): string | null {
  return text(doc.likeness?.avatar);
}
