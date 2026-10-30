'use client';

/**
 * Calls to the Book pipeline routes (`/api/books/**`). Every change to a Book
 * goes through these; the browser never writes the documents (ADR-0005).
 */
import { authFetch } from '@/lib/auth-fetch';
import type { BookStatus } from './types';

export class BookApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'BookApiError';
  }
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new BookApiError(
      payload?.error?.message || 'Something went wrong. Please try again.',
      payload?.error?.code || 'REQUEST_FAILED',
      response.status
    );
  }
  return payload.data as T;
}

export type CreateBookRequest = {
  storyId: string;
  formId: string;
  styleId: string;
  /** One per user action (e.g. one "make my book" tap); a repeat returns the same Book, charged once. */
  idempotencyKey: string;
};

export type CreateBookResponse = { bookId: string; manuscriptId: string; status: BookStatus; created: boolean };

export function createBook(request: CreateBookRequest): Promise<CreateBookResponse> {
  return post<CreateBookResponse>('/api/books', request);
}

export function retryBookPage(bookId: string, pageNumber: number): Promise<{ bookId: string; pageNumber: number; status: BookStatus }> {
  return post(`/api/books/${encodeURIComponent(bookId)}/pages/${pageNumber}/retry`);
}

export function lockBook(bookId: string): Promise<{ bookId: string; status: BookStatus }> {
  return post(`/api/books/${encodeURIComponent(bookId)}/lock`);
}

export function unlockBook(bookId: string): Promise<{ bookId: string; status: BookStatus }> {
  return post(`/api/books/${encodeURIComponent(bookId)}/unlock`);
}

/** A fresh idempotency key; `crypto.randomUUID` where available. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One idempotency key per choice: asking again for the same choice (a double
 * tap, or a retry after a network error) returns the same key, so the server
 * returns the same Book and charges once; a different choice gets a new key.
 */
export class ChoiceKeys {
  private last: { choice: string; key: string } | null = null;

  constructor(private readonly makeKey: () => string = newIdempotencyKey) {}

  keyFor(choice: string): string {
    if (this.last?.choice !== choice) this.last = { choice, key: this.makeKey() };
    return this.last.key;
  }
}
