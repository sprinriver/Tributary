# 21 CFR Part 11: controls map

This maps Tributary's controls to the requirements of 21 CFR Part 11 for closed systems (§11.10) and for
electronic signatures (Subpart C).

Tributary is **"Part 11-ready", not validated**:
- **The product provides:** the technical controls listed here.
- **The customer provides:**
  - validation;
  - procedures (SOPs);
  - training;
  - the identity provider's controls over accounts and passwords.
- **Partly:** a clause the product covers only in part is marked so.

| Clause | Requirement (summary) | Tributary control | Owner | Coverage |
|---|---|---|---|---|
| §11.10(a) | Validation of systems | Traceability matrix, IQ/OQ templates, CI evidence per release (this pack) | Customer (validation); vendor (evidence) | Supports |
| §11.10(b) | Accurate and complete copies, human-readable and electronic | Exports of releases, audit log (CSV), reports (PDF/PowerPoint), SDRF; open formats (Parquet) | Product | Yes |
| §11.10(c) | Protection of records for their retention period | Published versions and releases immutable (database triggers); soft delete only; storage lifecycle policies; encrypted storage; backups | Product + customer (retention schedule, backups) | Yes |
| §11.10(d) | Limiting access to authorised individuals | Single sign-on; per-program roles; SCIM deactivation; scoped, expiring tokens | Product + customer (IdP) | Yes |
| §11.10(e) | Secure, computer-generated, time-stamped audit trails; changes do not obscure prior values | Append-only audit log of every change and export, with actor, UTC time, before/after and reason; kept with the records | Product | Yes |
| §11.10(f) | Operational system checks (sequencing) | Enforced workflow: draft → validated manifest → publish; QC gate before import; releases staged before publish | Product | Yes |
| §11.10(g) | Authority checks | Role checks on every API call (contributor / approver / admin); approvals required where a program needs them | Product + customer (role assignment) | Yes |
| §11.10(h) | Device checks | Not applicable to a web application without instruments; input validation at every API boundary | — | N/A |
| §11.10(i) | Training of people who use the system | User and admin guides | Customer | Procedural |
| §11.10(j) | Written policies holding individuals accountable for signed actions | — | Customer | Procedural |
| §11.10(k) | Controls over system documentation | Versioned docs and CHANGELOG in the repository; ADRs | Vendor + customer (document control) | Supports |
| §11.50 | Signature manifestations: name, date and time, meaning | A publish records who (name), when (UTC) and a reason, shown in history and the audit log. The "meaning" is the publish reason; there is no separate signature meaning list (e.g. "approved", "reviewed"). | Product | Partial |
| §11.70 | Signatures linked to their records | The publish record is part of the version (immutable), so it cannot be removed or copied to another record | Product | Yes |
| §11.100 | Electronic signatures unique to one individual | Identities come from the customer's IdP; tokens are personal | Customer (IdP) + product | Supports |
| §11.200 | Signature components (ID and password; re-entry in a session) | Re-authentication with the IdP before publish when the last sign-in is older than the configured window | Product + customer (IdP) | Partial |
| §11.300 | Controls for identification codes and passwords | Password policy, ageing and lockout are the IdP's | Customer (IdP) | Procedural |

**Not provided today:**
- Formal electronic signatures with a configurable signature meaning list.
- Two-person (dual) signatures.

If your intended use needs them, raise it before procurement.
