import { randomUUID } from 'crypto';

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Logger interface for structured logging
 */
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Logger context for creating scoped loggers
 */
export interface LoggerContext {
  route?: string;
  method?: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Create a structured logger with context
 */
export function createLogger(context: LoggerContext): Logger {
  const prefix = context.requestId ? `[${context.requestId}]` : '';
  const routeInfo = context.route ? ` ${context.method || 'REQ'} ${context.route}` : '';

  const formatMessage = (level: string, message: string, data?: Record<string, unknown>): string => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `${timestamp} ${level}${prefix}${routeInfo}: ${message}${dataStr}`;
  };

  return {
    info(message: string, data?: Record<string, unknown>) {
      console.log(formatMessage('INFO', message, data));
    },
    warn(message: string, data?: Record<string, unknown>) {
      console.warn(formatMessage('WARN', message, data));
    },
    error(message: string, error?: Error | unknown, data?: Record<string, unknown>) {
      const errorData = error instanceof Error
        ? { ...data, errorName: error.name, errorMessage: error.message, stack: error.stack?.split('\n').slice(0, 3).join('\n') }
        : { ...data, error: String(error) };
      console.error(formatMessage('ERROR', message, errorData));
    },
    debug(message: string, data?: Record<string, unknown>) {
      if (process.env.NODE_ENV === 'development') {
        console.debug(formatMessage('DEBUG', message, data));
      }
    },
  };
}

/**
 * Create a timeout controller with logging
 */
export function createTimeoutController(
  timeoutMs: number,
  logger: Logger,
  operationName: string
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    logger.warn(`${operationName} timeout after ${timeoutMs}ms`);
    controller.abort();
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timeoutId);
  };

  return { controller, cleanup };
}

/**
 * Concurrency limiter for controlling parallel operations
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Wait if at capacity
    if (this.running >= this.maxConcurrency) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve);
      });
    }

    this.running++;

    try {
      return await fn();
    } finally {
      this.running--;
      // Release next waiting task
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}
