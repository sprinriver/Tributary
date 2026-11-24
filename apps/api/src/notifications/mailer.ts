// Email transports for personal notifications (Phase 34): Amazon SES or SMTP, chosen by EMAIL_TRANSPORT.
import type { ApiConfig } from '../config.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** Tests: keeps what was sent; can be made to fail. */
export class MemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  #failing = false;
  fail(failing: boolean): void {
    this.#failing = failing;
  }
  async send(message: EmailMessage): Promise<void> {
    if (this.#failing) throw new Error('mail transport unavailable');
    this.sent.push(message);
  }
}

/** The configured transport, or null when email is off. Libraries load only when used. */
export function mailerFromConfig(config: ApiConfig): Mailer | null {
  const { email } = config;
  if (email.transport === 'ses') {
    let client: Promise<{ send: (m: EmailMessage) => Promise<void> }> | undefined;
    const ses = () =>
      (client ??= import('@aws-sdk/client-sesv2').then(({ SESv2Client, SendEmailCommand }) => {
        const c = new SESv2Client({ region: email.sesRegion });
        return {
          send: async (m: EmailMessage) => {
            await c.send(
              new SendEmailCommand({
                FromEmailAddress: email.from,
                Destination: { ToAddresses: [m.to] },
                Content: {
                  Simple: {
                    Subject: { Data: m.subject, Charset: 'UTF-8' },
                    Body: { Text: { Data: m.text, Charset: 'UTF-8' } },
                  },
                },
              }),
            );
          },
        };
      }));
    return { send: async (m) => (await ses()).send(m) };
  }
  if (email.transport === 'smtp') {
    if (!email.smtpUrl) throw new Error('EMAIL_TRANSPORT=smtp needs SMTP_URL');
    let transport:
      Promise<{ sendMail: (m: EmailMessage & { from: string }) => Promise<unknown> }> | undefined;
    const smtp = () =>
      (transport ??= import('nodemailer').then((n) => n.default.createTransport(email.smtpUrl)));
    return {
      send: async (m) => {
        await (await smtp()).sendMail({ ...m, from: email.from });
      },
    };
  }
  return null;
}
