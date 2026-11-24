import { NotificationPreferencesBodySchema, NotificationPreferencesSchema } from './email.ts';
import type { ApiRoute } from './route.ts';

/** Personal email preferences (Phase 34). Part of API_ROUTES. */
export const EMAIL_ROUTES = {
  getNotificationPreferences: {
    method: 'get',
    path: '/v1/me/notification-preferences',
    summary: 'Your email notification choices',
    response: NotificationPreferencesSchema,
  },
  putNotificationPreferences: {
    method: 'put',
    path: '/v1/me/notification-preferences',
    summary: 'Change your email notification choices (audited)',
    body: NotificationPreferencesBodySchema,
    response: NotificationPreferencesSchema,
    reason: true,
  },
} as const satisfies Record<string, ApiRoute>;
