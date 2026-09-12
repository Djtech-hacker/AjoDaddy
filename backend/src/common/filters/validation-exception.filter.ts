// ============================================================
// VALIDATION EXCEPTION FILTER
// ============================================================
// main.ts's ValidationPipe uses a custom exceptionFactory:
//
//   exceptionFactory: (errors) => new BadRequestException(errors)
//
// `errors` here is class-validator's raw ValidationError[] — each item
// looks like:
//   { property: 'password', constraints: { matches: 'Password must
//     contain uppercase, lowercase, and a number' }, ... }
//
// Passing an array/object (not a string) to BadRequestException means
// exception.getResponse() returns that array AS-IS — there is no
// wrapping { message: ... } shape at that point. The existing
// HttpExceptionFilter then falls back to a hardcoded generic
// "Validation failed" string because it doesn't know how to read a
// raw ValidationError[]. That's why the frontend only ever sees
// "Validation failed" instead of the real constraint message.
//
// This filter runs BEFORE HttpExceptionFilter (see main.ts ordering
// note below) and, specifically for BadRequestException, digs the
// first real constraint message out of that array and returns it as
// `message` — so err.response.data.message on the frontend is now the
// actual reason, with zero frontend changes needed.
// ============================================================

import {
  ExceptionFilter, Catch, ArgumentsHost,
  BadRequestException, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

function extractFirstConstraintMessage(errors: any[]): string | null {
  for (const err of errors) {
    if (err?.constraints) {
      const values = Object.values(err.constraints) as string[];
      if (values.length > 0) return values[0];
    }
    // Nested validation (e.g. DTO with a nested object) puts failures
    // under `children` instead of `constraints` on the top-level item.
    if (Array.isArray(err?.children) && err.children.length > 0) {
      const nested = extractFirstConstraintMessage(err.children);
      if (nested) return nested;
    }
  }
  return null;
}

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const exceptionResponse = exception.getResponse() as any;

    let friendlyMessage: string;
    let rawErrors: any[] | undefined;

    if (Array.isArray(exceptionResponse)) {
      // This project's shape: exceptionFactory passed the raw
      // ValidationError[] straight into BadRequestException, so
      // getResponse() IS that array.
      rawErrors = exceptionResponse;
      friendlyMessage = extractFirstConstraintMessage(exceptionResponse) || 'Invalid request';
    } else if (Array.isArray(exceptionResponse?.message)) {
      // Default Nest ValidationPipe shape (no custom exceptionFactory):
      // { message: ["password must be longer than...", ...] }
      rawErrors = exceptionResponse.message;
      friendlyMessage = exceptionResponse.message[0] || 'Invalid request';
    } else if (typeof exceptionResponse?.message === 'string') {
      // A plain `throw new BadRequestException('some string')` from
      // regular application code (not validation) — pass through as-is.
      friendlyMessage = exceptionResponse.message;
    } else {
      friendlyMessage = 'Invalid request';
    }

    response.status(HttpStatus.BAD_REQUEST).json({
      success: false,
      statusCode: HttpStatus.BAD_REQUEST,
      message: friendlyMessage,
      errors: rawErrors,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}