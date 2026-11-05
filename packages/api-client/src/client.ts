/**
 * The StoryPic API, grouped by area. One client for the web app, the kids PWA
 * and the mobile app (Phase 6.1): every client calls the same functions and
 * gets the same types.
 */
import type {
  AdminOrderView,
  AvatarSource,
  BookListItem,
  BookReadView,
  BookStatus,
  CharacterProfileInput,
  CharacterView,
  ChildInput,
  ChildProfileInput,
  ChildRecord,
  ChildView,
  CreateBookRequest,
  CreateBookResponse,
  CreateOrderRequest,
  CreateStoryRequest,
  CreationModeView,
  ImageStyle,
  LibrarySummary,
  OrderSettings,
  OrderStatus,
  OrderView,
  PersonKind,
  PersonView,
  PrintOption,
  RenderView,
  StoryOutputType,
  StoryStatus,
  StoryTurnResult,
  StoryTurnView,
  StoryView,
  TTSRequest,
  TTSResponse,
} from '@storypic/shared-types';
import { createTransport, query, seg, StoryPicApiError, type StoryPicClientConfig, type Transport } from './http';

type ViewOf<K extends PersonKind> = K extends 'child' ? ChildView : CharacterView;
type InputOf<K extends PersonKind> = K extends 'child' ? ChildProfileInput : CharacterProfileInput;

const PEOPLE: Record<PersonKind, string> = { child: '/children', character: '/characters' };

function storiesApi(t: Transport) {
  return {
    /** The ways a child can make a story: live, enabled for kids, in order, exactly one `recommended`. */
    listModes: async (): Promise<CreationModeView[]> => (await t.call<{ modes: CreationModeView[] }>('GET', '/creation-modes')).modes,
    /** One `idempotencyKey` per tap; a repeat returns the same Story and first turn. 402 ENTITLEMENT_LIMIT without allowance. */
    create: (input: CreateStoryRequest) => t.call<StoryTurnResult>('POST', '/stories', input),
    /**
     * The child's answer. One key per answer. 409 TURN_IN_PROGRESS: still being worked on (repeat later);
     * 409 TURN_CONFLICT: another answer came first; 503: the AI was unavailable, nothing recorded.
     */
    sendTurn: (storyId: string, input: ChildInput, idempotencyKey: string) =>
      t.call<StoryTurnResult>('POST', `/stories/${seg(storyId)}/turns`, { input, idempotencyKey }),
    abandon: (storyId: string) => t.call<{ storyId: string; status: StoryStatus }>('POST', `/stories/${seg(storyId)}/abandon`),
    /** A Story that failed while finishing goes back to finishing. */
    retryFinish: (storyId: string) => t.call<{ storyId: string; status: StoryStatus }>('POST', `/stories/${seg(storyId)}/finish`),
    /** The child's Stories, newest first (abandoned ones left out), names resolved on the server. */
    list: async (childId: string): Promise<StoryView[]> => (await t.call<{ stories: StoryView[] }>('GET', `/stories${query({ childId })}`)).stories,
    get: (storyId: string) => t.call<{ story: StoryView; turns: StoryTurnView[] }>('GET', `/stories/${seg(storyId)}`),
  };
}

function booksApi(t: Transport) {
  return {
    /** The server runs the whole pipeline; one key per "make my book" tap (charged once). */
    create: (input: CreateBookRequest) => t.call<CreateBookResponse>('POST', '/books', input),
    /** The family's Books, newest first, optionally for one child or story. */
    list: (filter: { childId?: string; storyId?: string } = {}) => t.call<BookListItem[]>('GET', `/books${query(filter)}`),
    /** One Book in full: pages (words and picture) and live progress. */
    get: (bookId: string) => t.call<BookReadView>('GET', `/books/${seg(bookId)}`),
    retryPage: (bookId: string, pageNumber: number) =>
      t.call<{ bookId: string; pageNumber: number; status: BookStatus }>('POST', `/books/${seg(bookId)}/pages/${seg(pageNumber)}/retry`),
    lock: (bookId: string) => t.call<{ bookId: string; status: BookStatus }>('POST', `/books/${seg(bookId)}/lock`),
    unlock: (bookId: string) => t.call<{ bookId: string; status: BookStatus }>('POST', `/books/${seg(bookId)}/unlock`),
    printOptions: (bookId: string) => t.call<PrintOption[]>('GET', `/books/${seg(bookId)}/print-options`),
    /** Start a print render; locks the Book. */
    startRender: (bookId: string, layoutId: string, idempotencyKey: string) =>
      t.call<{ renderId: string; jobId: string; status: 'rendering' | 'ready' }>('POST', `/books/${seg(bookId)}/renders`, { layoutId, idempotencyKey }),
    getRender: (bookId: string, renderId: string) => t.call<RenderView>('GET', `/books/${seg(bookId)}/renders/${seg(renderId)}`),
    listRenders: (bookId: string) => t.call<RenderView[]>('GET', `/books/${seg(bookId)}/renders`),
  };
}

function ordersApi(t: Transport) {
  const order = (id: string, rest = '') => `/orders/${seg(id)}${rest}`;
  const admin = (id: string, rest = '') => `/admin/orders/${seg(id)}${rest}`;
  return {
    create: (input: CreateOrderRequest) => t.call<OrderView>('POST', '/orders', input),
    list: () => t.call<OrderView[]>('GET', '/orders'),
    get: (orderId: string) => t.call<OrderView>('GET', order(orderId)),
    /** Stripe Checkout: the page to send the parent to. */
    checkout: (orderId: string) => t.call<{ url: string }>('POST', order(orderId, '/checkout')),
    payWithCredits: (orderId: string) => t.call<OrderView>('POST', order(orderId, '/pay-with-credits')),
    cancel: (orderId: string) => t.call<OrderView>('POST', order(orderId, '/cancel')),
    admin: {
      list: (status?: OrderStatus | null) => t.call<AdminOrderView[]>('GET', `/admin/orders${query({ status: status ?? null })}`),
      get: (orderId: string) => t.call<AdminOrderView>('GET', admin(orderId)),
      approve: (orderId: string) => t.call<AdminOrderView>('POST', admin(orderId, '/approve')),
      cancel: (orderId: string, note: string | null) => t.call<AdminOrderView>('POST', admin(orderId, '/cancel'), { note }),
      markPaid: (orderId: string, note: string) => t.call<AdminOrderView>('POST', admin(orderId, '/mark-paid'), { note }),
      retrySubmit: (orderId: string, force: boolean) => t.call<AdminOrderView>('POST', admin(orderId, '/retry'), { force }),
      refresh: (orderId: string) => t.call<AdminOrderView>('POST', admin(orderId, '/refresh')),
      getSettings: () => t.call<OrderSettings>('GET', '/admin/orders/settings'),
      updateSettings: (patch: Partial<Pick<OrderSettings, 'requireAdminApproval' | 'notifyEmails'>>) =>
        t.call<OrderSettings>('PUT', '/admin/orders/settings', patch),
    },
  };
}

function peopleApi(t: Transport) {
  const item = (kind: PersonKind, id: string, rest = '') => `${PEOPLE[kind]}/${seg(id)}${rest}`;
  return {
    listChildren: () => t.call<ChildView[]>('GET', '/children?view=person'),
    listCharacters: (options: { childId?: string | null; includeHelp?: boolean } = {}) =>
      t.call<CharacterView[]>('GET', `/characters${query({ childId: options.childId ?? null, includeHelp: options.includeHelp ? '1' : null })}`),
    get: <K extends PersonKind>(kind: K, id: string) =>
      t.call<ViewOf<K>>('GET', kind === 'child' ? `${item(kind, id)}?view=person` : item(kind, id)),
    /** One key per create attempt; a repeat returns the same person. */
    create: <K extends PersonKind>(kind: K, input: InputOf<K> & { idempotencyKey: string }) => t.call<ViewOf<K>>('POST', PEOPLE[kind], input),
    update: <K extends PersonKind>(kind: K, id: string, patch: Partial<InputOf<K>>) => t.call<ViewOf<K>>('PATCH', item(kind, id), patch),
    remove: (kind: PersonKind, id: string) => t.call<{ id: string; deleted: true }>('DELETE', item(kind, id)),
    restore: (kind: PersonKind, id: string) => t.call<PersonView>('POST', item(kind, id, '/restore')),
    /** A data URL (image/*, ≤ 8 MB, ≤ 10 photos); the appearance and portrait are redone. */
    addPhoto: (kind: PersonKind, id: string, dataUrl: string) => t.call<PersonView>('POST', item(kind, id, '/photos'), { dataUrl }),
    removePhoto: (kind: PersonKind, id: string, photoId: string) => t.call<PersonView>('DELETE', item(kind, id, `/photos/${seg(photoId)}`)),
    refreshLikeness: (kind: PersonKind, id: string) => t.call<PersonView>('POST', item(kind, id, '/likeness/refresh')),
    setAvatar: (kind: PersonKind, id: string, source: AvatarSource, photoId?: string) =>
      t.call<PersonView>('POST', item(kind, id, '/avatar'), photoId ? { source, photoId } : { source }),
    /** Admin: one family's children or characters. */
    listOf: <K extends PersonKind>(kind: K, ownerUid: string) =>
      t.call<ViewOf<K>[]>('GET', `/admin/${kind === 'child' ? 'children' : 'characters'}${query({ ownerUid })}`),
    /** Admin: move to another family. */
    reassignOwner: (kind: PersonKind, id: string, ownerUid: string) =>
      t.call<PersonView>('PATCH', `/admin/${kind === 'child' ? 'children' : 'characters'}/${seg(id)}`, { ownerUid }),
    /** The bare shape the mobile app reads (stored fields plus `likeness`). */
    childRecords: () => t.raw<ChildRecord[]>('GET', '/children'),
    childRecord: (childId: string) => t.raw<ChildRecord>('GET', `/children/${seg(childId)}`),
  };
}

function catalogApi(t: Transport) {
  return {
    /** The Forms a finished Story can become (live output types). */
    outputTypes: async (): Promise<StoryOutputType[]> =>
      (await t.raw<{ ok: boolean; outputTypes?: StoryOutputType[] }>('GET', '/storyOutputTypes')).outputTypes ?? [],
    /** The art Styles a Book can be drawn in (preferred first). */
    imageStyles: async (): Promise<ImageStyle[]> => (await t.raw<{ ok: boolean; imageStyles?: ImageStyle[] }>('GET', '/imageStyles')).imageStyles ?? [],
  };
}

export function createStoryPicClient(config: StoryPicClientConfig) {
  const t = createTransport(config);
  return {
    stories: storiesApi(t),
    books: booksApi(t),
    orders: ordersApi(t),
    people: peopleApi(t),
    catalog: catalogApi(t),
    /** The family's Story and Book counts, in total and per child. */
    librarySummary: () => t.call<LibrarySummary>('GET', '/library/summary'),
    /** Text to speech; answers the audio URL. */
    speak: async (text: string, voiceId?: string, childId?: string): Promise<string> => {
      const body: TTSRequest = { text, voiceId, childId };
      const response = await t.raw<TTSResponse>('POST', '/tts', body);
      if (!response.ok || !response.audioUrl) throw new StoryPicApiError(response.errorMessage || 'Could not make the audio', 'TTS_FAILED', 500);
      return response.audioUrl;
    },
    /**
     * The parent PIN check: true when it matches, false for a wrong PIN. Throws for anything else
     * (429 PIN_LOCKED after too many tries, 400 PIN_NOT_SET, no connection).
     */
    verifyPin: async (pin: string): Promise<boolean> => {
      try {
        await t.raw<{ ok: true }>('POST', '/parent/verify-pin', { pin });
        return true;
      } catch (error) {
        if (error instanceof StoryPicApiError && error.code === 'INCORRECT_PIN') return false;
        throw error;
      }
    },
  };
}

export type StoryPicClient = ReturnType<typeof createStoryPicClient>;
