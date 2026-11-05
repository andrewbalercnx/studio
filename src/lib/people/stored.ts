/**
 * For admin tools that read stored `children` / `characters` documents
 * directly (admins may; parents read through the API): the owner and avatar
 * in either field shape. The old names (`ownerParentUid`, `avatarUrl`) go in
 * slice 6.3; then these read only the new ones.
 */
type Stored = { ownerUid?: unknown; ownerParentUid?: unknown; likeness?: { avatar?: unknown } | null; avatarUrl?: unknown };

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export function storedOwner(doc: Stored): string | null {
  return text(doc.ownerUid) ?? text(doc.ownerParentUid);
}

export function storedAvatar(doc: Stored): string | null {
  return text(doc.likeness?.avatar) ?? text(doc.avatarUrl);
}
