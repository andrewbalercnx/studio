/**
 * `withRoute`: the one wrapper every rebuilt App Router handler uses.
 *
 *   export const POST = withRoute({ auth: 'user', body: CreateBookBody }, async ({ user, body }) => {
 *     return createBook(user, body);
 *   });
 *
 * It verifies credentials for the declared auth mode, validates the JSON body
 * with zod, awaits the dynamic route params, and maps errors to one envelope:
 *
 *   success: { ok: true, data }                       (200 unless `ok(data, status)`)
 *   failure: { ok: false, error: { code, message, details? } }
 *
 * Auth modes:
 *   public   – no credentials checked
 *   user     – a valid Firebase ID token (Authorization header only)
 *   admin    – a valid ID token with the `isAdmin` claim
 *   internal – a Cloud Tasks OIDC token for the job invoker service account
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, BadRequestError, DataIntegrityError, ForbiddenError } from '../errors';
import { isAdmin, verifyInternalCaller, verifyUserToken, type InternalCaller, type VerifiedUser } from './auth';

export type AuthMode = 'public' | 'user' | 'admin' | 'internal';

type RouteParams = Record<string, string | string[] | undefined>;

export type RouteContext<A extends AuthMode, Body, Params> = {
  request: Request;
  params: Params;
  body: Body;
  user: A extends 'user' | 'admin' ? VerifiedUser : undefined;
  caller: A extends 'internal' ? InternalCaller : undefined;
};

export type RouteOptions<A extends AuthMode, BodySchema extends z.ZodTypeAny | undefined> = {
  auth: A;
  /** zod schema for the JSON body; omit for routes without a body. */
  body?: BodySchema;
  /** Label for server logs; defaults to the request path. */
  name?: string;
};

type BodyOf<BodySchema> = BodySchema extends z.ZodTypeAny ? z.output<BodySchema> : undefined;

/** Segment argument Next.js passes to route handlers. */
export type RouteSegment<Params> = { params: Promise<Params> };

const OK_RESPONSE = Symbol('withRoute.ok');

type OkResult = { [OK_RESPONSE]: true; data: unknown; status: number };

/** Return a success envelope with a non-200 status, e.g. `return ok(book, 201)`. */
export function ok(data: unknown, status = 200): OkResult {
  return { [OK_RESPONSE]: true, data, status };
}

function isOkResult(value: unknown): value is OkResult {
  return typeof value === 'object' && value !== null && (value as OkResult)[OK_RESPONSE] === true;
}

export function errorResponse(error: unknown, routeName = 'route'): NextResponse {
  if (error instanceof DataIntegrityError) {
    console.error(`[withRoute] ${routeName}: data integrity`, error.path, error.details);
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: 'Stored data is invalid' } },
      { status: 500 }
    );
  }
  if (error instanceof AppError) {
    const body: { code: string; message: string; details?: unknown } = { code: error.code, message: error.message };
    if (error.details !== undefined) body.details = error.details;
    return NextResponse.json({ ok: false, error: body }, { status: error.status });
  }
  console.error(`[withRoute] ${routeName}: unhandled error`, error);
  return NextResponse.json(
    { ok: false, error: { code: 'INTERNAL', message: 'Internal server error' } },
    { status: 500 }
  );
}

async function parseBody(request: Request, schema: z.ZodTypeAny): Promise<unknown> {
  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    throw new BadRequestError('Request body is not valid JSON', { code: 'INVALID_JSON' });
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestError('Request body failed validation', {
      code: 'INVALID_BODY',
      details: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  return result.data;
}

export function withRoute<
  A extends AuthMode,
  BodySchema extends z.ZodTypeAny | undefined = undefined,
  Params extends RouteParams = RouteParams,
>(
  options: RouteOptions<A, BodySchema>,
  handler: (ctx: RouteContext<A, BodyOf<BodySchema>, Params>) => unknown | Promise<unknown>
): (request: Request, segment?: RouteSegment<Params>) => Promise<Response> {
  return async (request, segment) => {
    let routeName = options.name ?? 'route';
    try {
      if (!options.name) routeName = new URL(request.url).pathname;
    } catch {
      // keep the default label
    }
    try {
      let user: VerifiedUser | undefined;
      let caller: InternalCaller | undefined;
      switch (options.auth) {
        case 'public':
          break;
        case 'user':
          user = await verifyUserToken(request);
          break;
        case 'admin':
          user = await verifyUserToken(request);
          if (!isAdmin(user)) throw new ForbiddenError('Admin access required');
          break;
        case 'internal':
          caller = await verifyInternalCaller(request);
          break;
        default: {
          const unknownMode: never = options.auth;
          throw new Error(`Unknown auth mode ${String(unknownMode)}`);
        }
      }

      const body = options.body ? await parseBody(request, options.body) : undefined;
      const params = (segment ? await segment.params : {}) as Params;

      const result = await handler({
        request,
        params,
        body: body as BodyOf<BodySchema>,
        user: user as RouteContext<A, BodyOf<BodySchema>, Params>['user'],
        caller: caller as RouteContext<A, BodyOf<BodySchema>, Params>['caller'],
      });

      if (result instanceof Response) return result;
      if (isOkResult(result)) {
        return NextResponse.json({ ok: true, data: result.data ?? null }, { status: result.status });
      }
      return NextResponse.json({ ok: true, data: result ?? null });
    } catch (error) {
      return errorResponse(error, routeName);
    }
  };
}
