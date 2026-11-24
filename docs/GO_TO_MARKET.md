# Market readiness: what stands between Tributary and its first paying customers

Internal planning note (2026-11-04). The product is feature-rich: 115 of 116 tracked features pass, and CI is
green. What it lacks are mostly the things a buyer's legal, security and IT teams ask for, plus a few features
that come up in every evaluation.

**Status on 2026-11-10** (see `docs/PROGRESS.md` for detail):
- **Done from §2:** reports (2), notifications (3), Excel manifests (4), SCIM (6), usage analytics (9). Also built:
  compound selectivity profiles and table, QC per condition, a Content-Security-Policy and API rate limiting.
- **Done from §3–5:** the security whitepaper, prepared questionnaire answers
  (`docs/sales/SECURITY_QUESTIONNAIRE.md`), the validation pack, the support bundle, a datasheet
  (`docs/sales/DATASHEET.md`) and a category comparison (`docs/sales/COMPARISON.md`).
- **Still open:**
  - the hosted demo (1): needs a hosting account;
  - ELN connectors (5): need the choice of system;
  - STRING networks (7) and TPP views (8): need network access to the format documentation, or the formats pasted;
  - PTM site-level data (8);
  - everything in §1 and §4, and the penetration test.

Rank: **P0** blocks a sale, **P1** shows up in most evaluations, **P2** differentiates or scales.

## 1. Decisions only you can make (P0, before any sales conversation)

| Decision | Why it matters now | Options |
|---|---|---|
| **Business model and licence** | The code is Apache-2.0 and the repository is set up as open source. Anyone may run it for free. | (a) **Open core**: keep the core Apache-2.0 and sell support, installation, validation packs and enterprise add-ons. (b) **Commercial licence** for future releases: relicense only the code you own; past Apache releases stay open. (c) **Managed service**: you run it in the customer's account for a fee. Most comparable companies combine (a) and (c). |
| **Product name and trademark** | "Tributary" is a working codename. Check trademark availability before printing anything. | Run a trademark search in your target markets, then rename (the name is in the UI shell, docs and the pitch). |
| **Legal entity, contracts** | Customers sign an MSA, an order form, a support SLA and (if you access their account) a DPA. | Templates from a lawyer. Because data stays in the customer's account, the DPA can be short. |
| **Pricing** | Buyers need a number to start procurement. | Suggestion to test, not a recommendation backed by data: a per-environment annual subscription in tiers by seats or programs. Add a paid pilot (fixed fee, credited on purchase) and paid onboarding for legacy data. |

## 2. Product work that sells (in recommended order)

| # | Item | Pri. | Size | Why buyers ask |
|---|---|---|---|---|
| 1 | **Hosted demo / sandbox** with the synthetic data and guided tour (`docs/DEMO.md` exists) | P0 | S | Every evaluation starts with "can I click around?". The Render, Oracle and HF guides exist; a stable public URL is missing. |
| 2 | **One-click experiment report** (PDF/slides of methods, QC, volcano, top hits, enrichment) | P1 | M | Programme meetings run on slides. Needs a PDF or slide library (dependency approval). |
| 3 | **Email / Teams / Slack notifications** for alerts, run completion and triage assignments | P1 | S–M | The in-app alerts exist; people do not live in the app. Webhooks from Phase 20 can carry them. |
| 4 | **Excel (XLSX) manifest import and export** | P1 | S | Sample sheets are Excel. Planned in SPEC v2.1. Needs an XLSX parser (dependency approval). |
| 5 | **ELN / compound-registry connectors** (e.g. Benchling, CDD Vault) | P1 | M–L | "Does it talk to our ELN?" is the most common integration question. Start with read-only compound and experiment sync over their APIs. |
| 6 | **SCIM user provisioning** and an admin page for API tokens | P1 | M | IT teams want joiners and leavers handled by their identity provider. |
| 7 | **STRING interaction networks** (Phase 31, started) | P2 | M | Blocked on network access to string-db.org, or on you pasting the format README. |
| 8 | **PTM site-level data and TPP / thermal-proteome views** | P2 | L | Strong differentiator for chemoproteomics teams (SPEC v2.1). |
| 9 | **Usage analytics for admins** (who uses what, opt-in, stays in the account) | P2 | S | Champions need numbers to defend the renewal. |

## 3. Trust package (P0/P1, mostly documents, not code)

- **Security whitepaper** (P0): architecture, data flow (nothing leaves the account), SSO, roles, audit, encryption,
  SBOM, the licence allowlist, the vulnerability disclosure policy (`SECURITY.md`). Most of it can be lifted from
  `docs/ARCHITECTURE.md` and SPEC §10.
- **Completed security questionnaires** (P0): pre-fill CAIQ-Lite or SIG-Lite once; reuse for every customer.
- **Independent penetration test** (P1): a third party, before the first production customer.
- **GxP / Part 11 validation pack** (P1, sellable add-on): requirement specs, traceability matrix (`features.json`
  already maps features to tests), IQ/OQ templates. Do not claim the product is validated.
- **SOC 2** (P2): your company's controls, not the product's. Only needed if you run customer environments.

## 4. Operations you need before the first customer (P0/P1)

- **Installer path**: the Terraform modules are plan-only in this repository by design. Run one real `apply` in a
  sandbox AWS account, time it, and write the 1-day install checklist (P0).
- **Upgrades and backup/restore drill**: rehearse an upgrade across a migration and a restore from snapshot, and
  record the RPO and RTO you actually achieve (P0).
- **Support**: a support email or desk, a severity matrix with response times, and a diagnostics bundle (logs and
  versions) that customers can send (P1).
- **Release cadence and changelog**: semantic versions, signed release tags (v2.0.0 still needs creating), and an
  upgrade-notes section per release (P1).

## 5. Sales assets

| Asset | Status |
|---|---|
| Product overview PDF | Done: `docs/pitch/Tributary-product-overview.pdf` (fill in the contact line). |
| Demo script | Exists: `docs/DEMO.md`. Rehearse it against the hosted demo. |
| One-page datasheet | To do: condense the overview. |
| ROI one-pager | To do after the first pilot: measure time to results and time spent finding data before and after. Do not publish estimates without pilot data. |
| Case study | After the first pilot, with the customer's written permission. |
| Website / landing page | To do: the same messages as the pitch, plus a "book a pilot" form. |

## 6. A realistic first 8 weeks

1. **Weeks 1–2:**
   - Decide on the licence and business model, the name and pricing to test.
   - Stand up the hosted demo.
   - Write the security whitepaper.
2. **Weeks 3–4:**
   - Notifications (email/Teams).
   - XLSX manifests.
   - A real Terraform apply, plus upgrade and restore drills.
   - Pre-fill one security questionnaire.
3. **Weeks 5–8:**
   - Two or three paid pilots.
   - Experiment reports.
   - The first connector, chosen by what the pilot customers use.
   - Book the penetration test.
