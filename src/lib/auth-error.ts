export class AuthError extends Error {
  status: number;
  code: 'UNAUTHENTICATED' | 'FORBIDDEN';

  constructor(code: AuthError['code'], message?: string, status?: number) {
    super(message ?? code);
    this.code = code;
    this.status = status ?? (code === 'UNAUTHENTICATED' ? 401 : 403);
  }
}
