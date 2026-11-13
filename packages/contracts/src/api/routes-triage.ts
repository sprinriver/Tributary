import type { ApiRoute } from './route.ts';
import {
  AddTriageEvidenceBodySchema,
  CreateTriageBodySchema,
  ListTriageQuerySchema,
  TriageCommentBodySchema,
  TriageDetailSchema,
  TriageListSchema,
  UpdateTriageBodySchema,
} from './triage.ts';

/** Hit triage board (Phase 25). Part of API_ROUTES. */
export const TRIAGE_ROUTES = {
  listTriage: {
    method: 'get',
    path: '/v1/triage',
    summary: 'Triage items in the programs the caller can read',
    query: ListTriageQuerySchema,
    response: TriageListSchema,
  },
  createTriage: {
    method: 'post',
    path: '/v1/triage',
    summary:
      'Add a protein or compound to a program’s triage board (returns the existing item if already there)',
    body: CreateTriageBodySchema,
    response: TriageDetailSchema,
    status: 201,
    reason: true,
  },
  getTriage: {
    method: 'get',
    path: '/v1/triage/{id}',
    summary: 'A triage item with its evidence and history',
    response: TriageDetailSchema,
  },
  updateTriage: {
    method: 'patch',
    path: '/v1/triage/{id}',
    summary: 'Change status (with a reason) or owner',
    body: UpdateTriageBodySchema,
    response: TriageDetailSchema,
    reason: true,
  },
  commentTriage: {
    method: 'post',
    path: '/v1/triage/{id}/comments',
    summary: 'Comment on a triage item',
    body: TriageCommentBodySchema,
    response: TriageDetailSchema,
    status: 201,
  },
  addTriageEvidence: {
    method: 'post',
    path: '/v1/triage/{id}/evidence',
    summary:
      'Attach a release as evidence (a snapshot of this protein’s row when it is differential abundance)',
    body: AddTriageEvidenceBodySchema,
    response: TriageDetailSchema,
    status: 201,
  },
} as const satisfies Record<string, ApiRoute>;
