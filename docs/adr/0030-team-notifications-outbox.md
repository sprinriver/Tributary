# 0030 — Team notifications through an outbox, to Slack and Teams webhooks
Date: 2026-11-04 · Status: accepted
## Context
- **The need:** teams want to hear about finished runs, new results and triage decisions where they already talk.
- **What must not happen:** a slow or unavailable chat service must never slow or fail a publish.
- **Constraint:** messages leave the customer's account.
## Decision
- **Channels:** Slack and Microsoft Teams incoming webhooks, using only `fetch` (no new dependency).
  - **Slack:** a `text` message with an escaped title, lines and a link.
  - **Teams:** an Adaptive Card 1.4 message, which channel webhooks and Workflows accept.
  - These formats were written without access to the vendors' documentation from the build environment. The admin
    page's **Send test** checks them against a real channel.
- **Outbox:**
  - The request that causes an event writes one `notification_delivery` row per matching route, after its own
    transaction.
  - A sweep runs every 15 s in each API process. It claims due rows with `FOR UPDATE SKIP LOCKED`, so several
    replicas are safe, and sends them.
  - A failure backs off 30 s, 1, 2 and 4 min; the fifth attempt is final.
  - Rows stuck in `sending` for 10 min (a crashed process) are taken again.
- **Routes:** routes belong to system admins.
  - URLs must be https on the services' own hosts, plus `NOTIFY_EXTRA_HOSTS`. In production the SSRF guard also
    rejects private addresses, at creation and at each send.
  - The URL is never returned by the API or written to the audit log.
- **Content:** names, statuses, the actor, a triage reason and a link. No data values.
## Consequences
- Delivery is at least once. A crash between a send and its update can repeat one message.
- Personal email is not included yet: it needs a mail transport (SES or SMTP) dependency approval.
## Revisit when
Customers ask for per-user preferences, email digests, or another chat service.
