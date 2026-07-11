/**
 * @module @beamflow/server/auth-context
 *
 * Helpers for reading the authenticated caller's identity and access scope off a
 * request. Routes go through these instead of reaching into `req.user` directly,
 * so the token shape lives in one place — and so the day we add org-switching or
 * per-project access, only this file changes.
 */

import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';

interface JwtUser {
  id: string;
  email: string;
  name: string;
  orgId?: string;
}

/** The creating user's id — provenance/attribution, not the access gate. */
export function getUserId(req: FastifyRequest): string {
  return (req.user as JwtUser).id;
}

/**
 * The caller's active organization id — the access scope every data query is
 * filtered by. Throws 401 if the token carries no org (a stale token minted
 * before the org model); the client should re-authenticate to get a fresh one.
 */
export function getOrgId(req: FastifyRequest): string {
  const orgId = (req.user as JwtUser).orgId;
  if (!orgId) {
    throw new ApiError(401, 'Session has no organization. Please sign in again.');
  }
  return orgId;
}
