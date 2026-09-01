// ============================================================
// COMMON — Filters, interceptors, decorators
// ============================================================

import {
  ExceptionFilter, Catch, ArgumentsHost, HttpException,
  HttpStatus, Injectable, NestInterceptor, ExecutionContext,
  CallHandler, Logger, createParamDecorator,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

// ── Global HTTP exception filter ──────────────────────────────
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx  = host.switchToHttp();
    const res  = ctx.getResponse<Response>();
    const req  = ctx.getRequest<Request>();

    let status  = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = undefined;

    if (exception instanceof HttpException) {
      status  = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object') {
        message = (resp as any).message || message;
        errors  = (resp as any).errors;
        // class-validator returns arrays
        if (Array.isArray(message)) {
          errors  = message;
          message = 'Validation failed';
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error on ${req.method} ${req.url}`, exception.stack);
    }

    res.status(status).json({
      success:   false,
      statusCode: status,
      message,
      errors,
      path:      req.url,
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Response transform interceptor ────────────────────────────
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, any> {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => {
        // Don't wrap if already has success field (manually shaped)
        if (data && typeof data === 'object' && 'success' in data) return data;
        return { success: true, data };
      }),
    );
  }
}

// ── Request logging interceptor ───────────────────────────────
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req   = ctx.switchToHttp().getRequest<Request>();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(`${req.method} ${req.url} — ${ms}ms`);
      }),
      catchError(err => {
        const ms = Date.now() - start;
        this.logger.warn(`${req.method} ${req.url} — ${ms}ms — ERROR: ${err.message}`);
        return throwError(() => err);
      }),
    );
  }
}

// ── Current user decorator ────────────────────────────────────
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);
