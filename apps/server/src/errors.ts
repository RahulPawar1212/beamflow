/**
 * @module @beamflow/server/errors
 *
 * Shared HTTP error type and a Fastify error handler, so routes can `throw`
 * instead of hand-writing `reply.status(...).send({ error })` everywhere.
 * All error responses share one JSON envelope: `{ error, issues? }`.
 */

import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * An error carrying an HTTP status code and optional structured `issues`
 * (e.g. graph/IR validation problems). Thrown from route handlers and rendered
 * by {@link registerErrorHandler}.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly issues?: unknown;

  constructor(statusCode: number, message: string, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.issues = issues;
  }
}

/** 404 helper. */
export function notFound(message: string): ApiError {
  return new ApiError(404, message);
}

/** 400 helper, optionally carrying structured validation `issues`. */
export function badRequest(message: string, issues?: unknown): ApiError {
  return new ApiError(400, message, issues);
}

/**
 * Register a single error handler that renders every thrown error as
 * `{ error, issues? }` with the appropriate status:
 * - {@link ApiError} → its `statusCode` (+ `issues` when present)
 * - Fastify validation errors → 400
 * - anything else → 500 (message preserved; logged via `request.log`)
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError & { issues?: unknown }, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof ApiError) {
        return reply
          .status(error.statusCode)
          .send(error.issues !== undefined ? { error: error.message, issues: error.issues } : { error: error.message });
      }

      // Fastify's built-in schema/validation errors set statusCode 400.
      if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
        return reply.status(error.statusCode).send({ error: error.message });
      }

      // Unexpected: log the full error and return a 500 with the message.
      request.log.error(error);
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message });
    },
  );
}
