#!/usr/bin/env node
/**
 * Firestore security-rules checks against the emulator.
 *
 *   npm run test:rules
 *
 * Each check performs one client-SDK operation as a mock parent (or admin) and
 * asserts that the rules allow or deny it. The cases cover every browser write
 * the app makes today (they must stay allowed) and the server-trusted fields
 * the browser must not touch (they must stay denied). Add a case whenever a
 * rule or a client write changes.
 */
import { initializeApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, getDocs, addDoc, collection, query, where, serverTimestamp,
} from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

function client(name, token) {
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-rules', apiKey: 'demo' }, name);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(port), { mockUserToken: token });
  return db;
}

const parent = client('parent', { sub: 'p1', user_id: 'p1' });
const admin = client('admin', { sub: 'a1', user_id: 'a1', isAdmin: true });

let failures = 0;
async function check(label, expected, operation) {
  let actual;
  try {
    await operation();
    actual = 'allow';
  } catch (error) {
    actual = error.code === 'permission-denied' ? 'deny' : `error:${error.code}`;
  }
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`);
}

// Seed as admin.
await setDoc(doc(admin, 'children', 'c1'), { ownerParentUid: 'p1', displayName: 'Emma' });
await setDoc(doc(admin, 'storySessions', 's1'), { parentUid: 'p1', childId: 'c1', arcStepIndex: 0 });
await setDoc(doc(admin, 'stories', 's1'), { parentUid: 'p1', childId: 'c1', metadata: { title: 'Old', characterIds: [] }, isLocked: false });
await setDoc(doc(admin, 'stories', 's1', 'storybooks', 'b1'), {
  parentUid: 'p1', storyId: 's1', isLocked: false,
  artStatus: { completeness: 'degraded', recoveryNotified: false }, finalization: { status: 'draft' },
});
await setDoc(doc(admin, 'systemConfig', 'diagnostics'), { enableAnalytics: false });
await setDoc(doc(admin, 'systemConfig', 'email'), { from: 'orders@example.com' });

// users: roles and PIN state are server-owned.
await check('signup creates default roles', 'allow', () => setDoc(doc(parent, 'users', 'p1'), {
  email: 'p@example.com', roles: { isAdmin: false, isWriter: false, isParent: true }, createdAt: serverTimestamp(),
}));
await check('signup with isAdmin', 'deny', () => setDoc(doc(parent, 'users', 'p1'), { roles: { isAdmin: true, isWriter: false, isParent: true } }));
await check('grant own role', 'deny', () => updateDoc(doc(parent, 'users', 'p1'), { 'roles.isWriter': true }));
await check('replace own PIN hash', 'deny', () => updateDoc(doc(parent, 'users', 'p1'), { pinHash: 'x' }));
await check('clear own PIN lockout', 'deny', () => updateDoc(doc(parent, 'users', 'p1'), { pinFailedAttempts: 0 }));
await check('mark startup wizard complete', 'allow', () => updateDoc(doc(parent, 'users', 'p1'), { hasCompletedStartupWizard: true }));

// children: owner field immutable; help-* samples server-only.
await check('create own child', 'allow', () => setDoc(doc(parent, 'children', 'c2'), { ownerParentUid: 'p1', displayName: 'Sam' }));
await check('create help-* child', 'deny', () => setDoc(doc(parent, 'children', 'help-x'), { ownerParentUid: 'p1' }));
await check('rename own child', 'allow', () => updateDoc(doc(parent, 'children', 'c1'), { displayName: 'Em' }));
await check('move child to another family', 'deny', () => updateDoc(doc(parent, 'children', 'c1'), { ownerParentUid: 'victim' }));

// storySessions: compile lock and allowance flag are server-owned.
await check('create own session', 'allow', () => setDoc(doc(parent, 'storySessions', 's2'), { parentUid: 'p1', childId: 'c1', status: 'in_progress' }));
await check('create session with allowance flag', 'deny', () => setDoc(doc(parent, 'storySessions', 's3'), { parentUid: 'p1', storyAllowanceConsumed: true }));
await check('advance arc step / complete', 'allow', () => updateDoc(doc(parent, 'storySessions', 's1'), { arcStepIndex: 1, status: 'completed' }));
await check('set storyAllowanceConsumed', 'deny', () => updateDoc(doc(parent, 'storySessions', 's1'), { storyAllowanceConsumed: true }));
await check('set compileInProgress', 'deny', () => updateDoc(doc(parent, 'storySessions', 's1'), { compileInProgress: true }));
await check('move session to another family', 'deny', () => updateDoc(doc(parent, 'storySessions', 's1'), { parentUid: 'victim' }));
await check('add message to own session', 'allow', () => addDoc(collection(parent, 'storySessions', 's1', 'messages'), { role: 'user', text: 'hi' }));
await check('create help-* session', 'deny', () => setDoc(doc(parent, 'storySessions', 'help-s'), { parentUid: 'p1' }));

// stories: server-written; owner may rename, pick a style, soft-delete.
await check('create story directly', 'deny', () => setDoc(doc(parent, 'stories', 's9'), { parentUid: 'p1' }));
await check('rename story', 'allow', () => updateDoc(doc(parent, 'stories', 's1'), { 'metadata.title': 'New', updatedAt: serverTimestamp() }));
await check('pick art style', 'allow', () => setDoc(doc(parent, 'stories', 's1'), {
  selectedImageStyleId: 'w', selectedImageStylePrompt: 'p', updatedAt: serverTimestamp(),
}, { merge: true }));
await check('change other story metadata', 'deny', () => updateDoc(doc(parent, 'stories', 's1'), { 'metadata.characterIds': ['x'] }));
await check('lock story', 'deny', () => updateDoc(doc(parent, 'stories', 's1'), { isLocked: true }));

// storybooks: idle create; lock, finalization, art status and generation server-owned.
await check('create idle storybook', 'allow', () => addDoc(collection(parent, 'stories', 's1', 'storybooks'), {
  parentUid: 'p1', storyId: 's1', pageGeneration: { status: 'idle' }, imageGeneration: { status: 'idle' }, createdAt: serverTimestamp(),
}));
await check('create storybook with finalization', 'deny', () => addDoc(collection(parent, 'stories', 's1', 'storybooks'), {
  parentUid: 'p1', finalization: { printableCoverPdfUrl: 'https://example.com/x.pdf' },
}));
await check('create storybook already running', 'deny', () => addDoc(collection(parent, 'stories', 's1', 'storybooks'), {
  parentUid: 'p1', imageGeneration: { status: 'running' },
}));
await check('set printable PDF URL', 'deny', () => updateDoc(doc(parent, 'stories', 's1', 'storybooks', 'b1'), { 'finalization.printableCoverPdfUrl': 'https://example.com/x.pdf' }));
await check('mark art complete', 'deny', () => updateDoc(doc(parent, 'stories', 's1', 'storybooks', 'b1'), { 'artStatus.completeness': 'complete' }));
await check('acknowledge art recovery', 'allow', () => updateDoc(doc(parent, 'stories', 's1', 'storybooks', 'b1'), { 'artStatus.recoveryNotified': true }));
await check('lock storybook', 'deny', () => updateDoc(doc(parent, 'stories', 's1', 'storybooks', 'b1'), { isLocked: true }));
await check('soft-delete storybook', 'allow', () => updateDoc(doc(parent, 'stories', 's1', 'storybooks', 'b1'), {
  deletedAt: serverTimestamp(), deletedBy: 'p1', updatedAt: serverTimestamp(),
}));
await check('write storybook page', 'deny', () => setDoc(doc(parent, 'stories', 's1', 'storybooks', 'b1', 'pages', 'page-001'), { imageUrl: 'x' }));
await check('write share token', 'deny', () => setDoc(doc(parent, 'stories', 's1', 'shareTokens', 't1'), { status: 'active' }));
await check('read own story', 'allow', () => getDoc(doc(parent, 'stories', 's1')));

// print (#9).
await check('create print order', 'deny', () => addDoc(collection(parent, 'printOrders'), { parentUid: 'p1', paymentStatus: 'paid' }));
await check('create draft print storybook', 'allow', () => setDoc(doc(parent, 'printStoryBooks', 'pb1'), { ownerUserId: 'p1', storyId: 's1', pdfStatus: 'draft', pages: [] }));
await check('create print storybook with PDF', 'deny', () => setDoc(doc(parent, 'printStoryBooks', 'pb2'), {
  ownerUserId: 'p1', storyId: 's1', pdfStatus: 'draft', coverPdfUrl: 'https://example.com/x.pdf',
}));
await check('update own print storybook', 'deny', () => updateDoc(doc(parent, 'printStoryBooks', 'pb1'), { pdfStatus: 'ready' }));

// manuscripts, books, jobs (Phase 5): owner reads; only the server (Admin SDK) and admins write.
await setDoc(doc(admin, 'manuscripts', 'm1'), { ownerUid: 'p1', storyId: 's1', status: 'ready' });
await setDoc(doc(admin, 'manuscripts', 'm1', 'pages', '1'), { ownerUid: 'p1', pageNumber: 1, text: 'Once' });
await setDoc(doc(admin, 'manuscripts', 'm2'), { ownerUid: 'p2', storyId: 's2', status: 'ready' });
await setDoc(doc(admin, 'books', 'k1'), { ownerUid: 'p1', manuscriptId: 'm1', status: 'illustrating' });
await setDoc(doc(admin, 'books', 'k1', 'pages', '1'), { ownerUid: 'p1', pageNumber: 1, kind: 'cover', artUrl: null });
await setDoc(doc(admin, 'books', 'k1', 'castSheets', 'c1'), { ownerUid: 'p1', castId: 'c1', imageUrl: null });
await setDoc(doc(admin, 'books', 'k2'), { ownerUid: 'p2', manuscriptId: 'm2', status: 'ready' });
await setDoc(doc(admin, 'books', 'k2', 'pages', '1'), { ownerUid: 'p2', pageNumber: 1, kind: 'cover' });
await setDoc(doc(admin, 'jobs', 'j1'), { ownerUid: 'p1', kind: 'book.pageArt', status: 'running' });
await setDoc(doc(admin, 'jobs', 'j2'), { ownerUid: 'p2', kind: 'book.pageArt', status: 'running' });

await check('read own manuscript', 'allow', () => getDoc(doc(parent, 'manuscripts', 'm1')));
await check('read own manuscript page', 'allow', () => getDoc(doc(parent, 'manuscripts', 'm1', 'pages', '1')));
await check("read another family's manuscript", 'deny', () => getDoc(doc(parent, 'manuscripts', 'm2')));
await check('create manuscript', 'deny', () => setDoc(doc(parent, 'manuscripts', 'm3'), { ownerUid: 'p1', status: 'ready' }));
await check('update own manuscript', 'deny', () => updateDoc(doc(parent, 'manuscripts', 'm1'), { status: 'failed' }));
await check('write own manuscript page', 'deny', () => updateDoc(doc(parent, 'manuscripts', 'm1', 'pages', '1'), { text: 'x' }));
await check('read own book', 'allow', () => getDoc(doc(parent, 'books', 'k1')));
await check('list own books', 'allow', () => getDocs(query(collection(parent, 'books'), where('ownerUid', '==', 'p1'))));
await check('list all books', 'deny', () => getDocs(collection(parent, 'books')));
await check('read own book page', 'allow', () => getDoc(doc(parent, 'books', 'k1', 'pages', '1')));
await check('read own cast sheet', 'allow', () => getDoc(doc(parent, 'books', 'k1', 'castSheets', 'c1')));
await check("read another family's book", 'deny', () => getDoc(doc(parent, 'books', 'k2')));
await check("read another family's book page", 'deny', () => getDoc(doc(parent, 'books', 'k2', 'pages', '1')));
await check('create book', 'deny', () => setDoc(doc(parent, 'books', 'k3'), { ownerUid: 'p1', status: 'ready' }));
await check('lock own book directly', 'deny', () => updateDoc(doc(parent, 'books', 'k1'), { status: 'locked' }));
await check('set own page art', 'deny', () => updateDoc(doc(parent, 'books', 'k1', 'pages', '1'), { artUrl: 'https://example.com/x.png' }));
await check('read own job', 'allow', () => getDoc(doc(parent, 'jobs', 'j1')));
await check('list own jobs', 'allow', () => getDocs(query(collection(parent, 'jobs'), where('ownerUid', '==', 'p1'))));
await check("read another family's job", 'deny', () => getDoc(doc(parent, 'jobs', 'j2')));
await check('mark own job succeeded', 'deny', () => updateDoc(doc(parent, 'jobs', 'j1'), { status: 'succeeded' }));
await check('admin updates a book', 'allow', () => updateDoc(doc(admin, 'books', 'k1'), { status: 'ready' }));

// systemConfig: only diagnostics is readable by non-admins.
await check('read diagnostics', 'allow', () => getDoc(doc(parent, 'systemConfig', 'diagnostics')));
await check('read email config', 'deny', () => getDoc(doc(parent, 'systemConfig', 'email')));

console.log(failures ? `${failures} rule check(s) FAILED` : 'All rule checks passed');
process.exit(failures ? 1 : 0);
