import {
  CreateNotificationRouteBodySchema,
  NotificationDeliveryListSchema,
  NotificationDeliverySchema,
  NotificationRouteListSchema,
  NotificationRouteSchema,
  UpdateNotificationRouteBodySchema,
} from './notifications.ts';
import type { ApiRoute } from './route.ts';

/** Team notifications to Slack and Teams (Phase 31; system admins). Part of API_ROUTES. */
export const NOTIFICATION_ROUTES = {
  listNotificationRoutes: {
    method: 'get',
    path: '/v1/notification-routes',
    summary: 'Slack and Teams notification routes (system admin)',
    response: NotificationRouteListSchema,
  },
  createNotificationRoute: {
    method: 'post',
    path: '/v1/notification-routes',
    summary: 'Add a Slack or Teams channel for chosen events, all programs or one (audited)',
    body: CreateNotificationRouteBodySchema,
    response: NotificationRouteSchema,
    status: 201,
    reason: true,
  },
  updateNotificationRoute: {
    method: 'patch',
    path: '/v1/notification-routes/{id}',
    summary: 'Rename, change events, pause or resume a route (audited)',
    body: UpdateNotificationRouteBodySchema,
    response: NotificationRouteSchema,
    reason: true,
  },
  deleteNotificationRoute: {
    method: 'delete',
    path: '/v1/notification-routes/{id}',
    summary: 'Remove a route (soft delete, audited)',
    status: 204,
    reason: true,
  },
  testNotificationRoute: {
    method: 'post',
    path: '/v1/notification-routes/{id}/test',
    summary: 'Send a test message now and report the outcome',
    response: NotificationDeliverySchema,
  },
  listNotificationDeliveries: {
    method: 'get',
    path: '/v1/notification-routes/{id}/deliveries',
    summary: 'Recent deliveries of a route, newest first',
    response: NotificationDeliveryListSchema,
  },
} as const satisfies Record<string, ApiRoute>;
