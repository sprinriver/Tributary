# 0022 — AI assistant: tools call the API in-process as the user; injected provider clients; stub model in CI
Date: 2026-11-01 · Status: accepted
## Context
SPEC M12 and §11 ask for an optional assistant, off by default, whose tools run with the end user's identity.
Tools take zod inputs and carry a risk class; the model never writes SQL or code. Every tool call is audited, and
everything the assistant produces carries provenance. Budgets are monthly per deployment. Accuracy is measured by a
golden-question set in CI.
ARCHITECTURE §11 names the Vercel AI SDK tool loop, and the model SDKs (`@anthropic-ai/sdk`,
`@anthropic-ai/bedrock-sdk`) are not yet approved dependencies.
## Decision
- **Providers** (`apps/api/src/ai/provider.ts`): `none` (default), `stub`, `anthropic` and `bedrock`, chosen by
  `AI_PROVIDER` in the deployment, never by the browser.
  - `anthropicProvider({ model, create })` adapts the Messages API. The SDK's `messages.create` is injected, so the
    adapter has no SDK import and is unit-tested.
  - Requests use `tool_choice: auto` and adaptive thinking. The model's own content blocks (thinking included) are
    replayed verbatim inside a tool loop.
  - The adapter branches on `stop_reason` before reading content. A `refusal` becomes a polite explanation with
    its category (SPEC §11.7).
  - Server-side `fallbacks` is an option, off by default: it is a beta and is not available on Bedrock.
  - Until the SDKs are approved, `anthropic` and `bedrock` fail at startup with a message naming the package.
- **Own tool loop** (`assistant.ts`), not the Vercel AI SDK. It is about 100 lines: up to 8 tool steps per turn,
  and write tools are never offered until approvals exist (19b). This avoids a framework dependency for a loop we
  must control for approvals and audit anyway.
- **Tools run as the user** (`routes/ai.ts`). Each tool calls the public API in-process (`app.inject`), forwarding
  only the caller's `authorization`, `cookie` and `x-csrf-token` headers. Authorisation, program scoping, QuerySpec
  validation and audit are therefore the API's own, and there is no second permission model to keep in step.
  - A 404, or a 403 on a read, reaches the model as "not found, or not in a program you can read", so the
    assistant cannot reveal whether something exists.
- **Queries**: `build_query` validates a QuerySpec with zod and against the dataset contracts. Release-id sources
  are resolved through the API as the user. It returns the spec and an Explorer link (`/explore?q=`, base64url
  JSON, as the web app encodes it).
  - `run_query` re-validates, forces the first page (25 rows) and calls `POST /v1/query`.
- **Storage**: migration 0018 adds `ai_conversation` (private to its user) and `ai_message`.
  - Messages hold the text, the tool calls (input, output, error), provenance and refusal, plus token counts.
  - Monthly use is summed from assistant messages (UTC month). A turn is refused with 429 `ai_budget_exhausted`
    once use reaches the budget.
- **Settings**: `app_setting` key `ai` (`assistant_enabled`, `write_tools_enabled`, `monthly_token_budget`), set by
  system admins and audited. With a provider configured, the assistant is on until an admin switches it off.
- **Audit**: each tool call writes `ai.tool_call` with `actor_type = 'ai_assistant_on_behalf_of'`, the acting user
  and the conversation id. It records the input, status and error, never output rows.
- **Provenance** on every answer: provider, model, prompt version, tools called, QuerySpecs, release ids and tokens.
- **Stub model** (`stub.ts`): a deterministic planner for tests, CI, the e2e stack and the golden eval. It maps a
  few question shapes to tool calls and summarises tool results, so it never states data the tools did not return.
- **Writes need approval** (19b). With `write_tools_enabled`, a write tool call is validated and stored as
  `pending_approval` with a call id; nothing runs. `POST …/tool-calls/{callId}/decision` (owner only) works in three
  steps:
  1. It claims the proposal and commits (a second decision gets 409). It refuses to approve while the assistant or
     its write tools are switched off.
  2. It runs the write through the API as the user, with `X-Change-Reason` saying the assistant proposed it.
  3. It records the outcome.
  - Tool calls carry an `id` (calls stored before 19b are given `<message id>:<index>` on read).
- **Curation** (`curation.ts`): suggestions come only from `/v1/ontology/search` run as the user. A value is
  matched only when a returned label or synonym equals it, ignoring case, punctuation and "cells". Otherwise the
  answer is "no match", with the lookup's results as candidates. `apply_metadata_suggestions` looks each term up
  again at approval time.
- **Audit redaction**: tool input in `audit_log` keeps ids and term ids; other text is replaced by its length.
- **Budget**: checked before a turn and again between model calls.
- **Deferred**: streaming turns and `run_analysis` (budgeted compute), recorded in PLAN Phase 19.
## Consequences
- The assistant can do nothing the user could not do through the API, including scopes and CSRF.
- The stub's eval score measures the tools and search, not a model's reasoning. A real provider is run by hand
  once its SDK is approved, and that score is recorded in PROGRESS.
- Turns are not streamed yet: the panel waits for the whole turn. The tool calls are shown when it returns.
## Revisit when
The model SDKs are approved (wire `create`, add streaming), the MCP server (Phase 20) shares the registry, or
write tools with approval land (19b).
