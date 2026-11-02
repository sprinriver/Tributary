import { OnboardingPlanSchema, OnboardingRunSchema, OnboardingSpecSchema } from './onboarding.ts';
import type { ApiRoute } from './route.ts';

/** Legacy onboarding (Phase 23, ING-06). Part of API_ROUTES. */
export const ONBOARDING_ROUTES = {
  planOnboarding: {
    method: 'post',
    path: '/v1/onboarding/plan',
    summary: 'Dry run: experiments, inferred manifests and file roles for a folder layout (writes nothing)',
    body: OnboardingSpecSchema,
    response: OnboardingPlanSchema,
  },
  startOnboarding: {
    method: 'post',
    path: '/v1/onboarding/runs',
    summary:
      'Register a folder layout: experiments, manifests, linked files and batch imports, in resumable batches',
    body: OnboardingSpecSchema,
    response: OnboardingRunSchema,
    status: 201,
    reason: true,
  },
  getOnboarding: {
    method: 'get',
    path: '/v1/onboarding/runs/{id}',
    summary: 'Migration report: counts, failures, unmatched objects and every checksum',
    response: OnboardingRunSchema,
  },
  resumeOnboarding: {
    method: 'post',
    path: '/v1/onboarding/runs/{id}/resume',
    summary: 'Continue a run: pending items, then failed ones again',
    response: OnboardingRunSchema,
    reason: true,
  },
} as const satisfies Record<string, ApiRoute>;
