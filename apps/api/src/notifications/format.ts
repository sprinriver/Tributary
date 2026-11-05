// Message formats for Slack and Microsoft Teams incoming webhooks (Phase 31). Messages carry names, statuses and
// links only; the caller decides what goes into `lines`.

export interface Message {
  title: string;
  lines: string[];
  url: string;
}

/** Slack mrkdwn treats &, < and > as control characters. */
const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function slackPayload(m: Message) {
  return {
    text: [`*${slackEscape(m.title)}*`, ...m.lines.map(slackEscape), `<${m.url}|Open in Tributary>`].join(
      '\n',
    ),
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** An Adaptive Card message, as Teams channel webhooks and Workflows accept. */
export function teamsPayload(m: Message) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: m.title, weight: 'Bolder', wrap: true },
            ...m.lines.map((text) => ({ type: 'TextBlock', text, wrap: true, spacing: 'Small' })),
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open in Tributary', url: m.url }],
        },
      },
    ],
  };
}

export const payloadFor = (kind: string, m: Message) =>
  kind === 'teams' ? teamsPayload(m) : slackPayload(m);
