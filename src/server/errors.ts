/**
 * Typed error hierarchy shared by every server foundation module.
 *
 * Domain services, repositories and the job runner throw these; `withRoute`
 * (src/server/http) maps them to HTTP responses with one envelope. Anything
 * that is not an `AppError` becomes a 500 with a generic message, so internal
 * details never leak to clients.
 */

export type AppErrorOptions = {
  /** Machine-readable code; defaults per subclass. */
  code?: string;
  /** Extra structured information safe to show the caller (e.g. zod issues). */
  details?: unknown;
  cause?: unknown;
};

export abstract class AppError extends Error {
  abstract readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  protected constructor(defaultCode: string, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? defaultCode;
    this.details = options.details;
  }
}

/** 400: the request is malformed or fails validation. */
export class BadRequestError extends AppError {
  readonly status = 400;
  constructor(message = 'Bad request', options?: AppErrorOptions) {
    super('BAD_REQUEST', message, options);
  }
}

/** 401: no credentials, or credentials that do not verify. */
export class UnauthenticatedError extends AppError {
  readonly status = 401;
  constructor(message = 'Authentication required', options?: AppErrorOptions) {
    super('UNAUTHENTICATED', message, options);
  }
}

/** 402: the family has no allowance left for this (entitlements). */
export class PaymentRequiredError extends AppError {
  readonly status = 402;
  constructor(message = 'No allowance left', options?: AppErrorOptions) {
    super('PAYMENT_REQUIRED', message, options);
  }
}

/** 403: authenticated, but not allowed (not the owner, persona mismatch, not admin). */
export class ForbiddenError extends AppError {
  readonly status = 403;
  constructor(message = 'Forbidden', options?: AppErrorOptions) {
    super('FORBIDDEN', message, options);
  }
}

/** 404: the target does not exist. */
export class NotFoundError extends AppError {
  readonly status = 404;
  constructor(message = 'Not found', options?: AppErrorOptions) {
    super('NOT_FOUND', message, options);
  }
}

/** 409: the request conflicts with current state (already exists, lease held, wrong status). */
export class ConflictError extends AppError {
  readonly status = 409;
  constructor(message = 'Conflict', options?: AppErrorOptions) {
    super('CONFLICT', message, options);
  }
}

/**
 * 500: a stored document does not match its schema. Thrown by repositories so
 * malformed data fails loudly instead of flowing on as `any`. The response
 * message stays generic; the details are logged server-side.
 */
export class DataIntegrityError extends AppError {
  readonly status = 500;
  readonly path: string;
  constructor(path: string, details: unknown) {
    super('DATA_INTEGRITY', `Stored document ${path} does not match its schema`, { details });
    this.path = path;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
