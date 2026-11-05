// Which hosts a notification route may post to (Phase 31): the chat services' own webhook hosts, plus any the
// administrator adds (NOTIFY_EXTRA_HOSTS). Anything else is refused, so a route cannot be aimed at internal systems.
import { HttpError } from '../errors.ts';

const SLACK_HOSTS = ['hooks.slack.com'];
/** Teams channel webhooks (connectors) and Teams Workflows (Power Automate) endpoints. */
const TEAMS_SUFFIXES = ['.webhook.office.com', '.logic.azure.com', '.powerplatform.com'];

export function checkWebhookHost(kind: 'slack' | 'teams', url: string, extraHosts: string[]): void {
  const u = new URL(url);
  if (u.protocol !== 'https:')
    throw new HttpError(422, 'unsupported_webhook_host', 'Webhook URLs must use https.', 'url');
  const host = u.hostname.toLowerCase();
  const ok =
    extraHosts.includes(host) ||
    (kind === 'slack' ? SLACK_HOSTS.includes(host) : TEAMS_SUFFIXES.some((s) => host.endsWith(s)));
  if (!ok)
    throw new HttpError(
      422,
      'unsupported_webhook_host',
      kind === 'slack'
        ? 'A Slack route needs a Slack incoming-webhook URL (https://hooks.slack.com/…).'
        : 'A Teams route needs a Teams webhook or Workflows URL.',
      'url',
    );
}

/** What the API shows of a URL: scheme and host only (the path is the secret). */
export const urlHint = (url: string) => {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/…`;
};
