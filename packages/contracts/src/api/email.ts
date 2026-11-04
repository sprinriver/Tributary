import { z } from 'zod';

// Personal email (Phase 34, MAIL-01…03): each person chooses which of their own events reach their inbox.
export const PERSONAL_EVENTS = ['alert.created', 'triage.assigned', 'run.finished'] as const;
export const PersonalEventSchema = z.enum(PERSONAL_EVENTS);
export type PersonalEvent = z.infer<typeof PersonalEventSchema>;

export const NotificationPreferencesBodySchema = z
  .strictObject({ email: z.boolean(), events: z.array(PersonalEventSchema) })
  .meta({ id: 'NotificationPreferencesBody' });

export const NotificationPreferencesSchema = z
  .object({
    email: z.boolean(),
    events: z.array(PersonalEventSchema),
    /** Where emails go (the address from single sign-on). */
    address: z.string(),
    /** False when this installation has no mail transport configured. */
    email_available: z.boolean(),
  })
  .meta({ id: 'NotificationPreferences' });
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
