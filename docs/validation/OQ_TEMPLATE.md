# Operational qualification (OQ) protocol — template

| Field | Value |
|---|---|
| System / release | Tributary _2.1.0_ |
| Environment | _validation environment configured like production_ |
| Protocol ID / version | |
| Prepared by / date | |
| Approved by (QA) / date | |

## Part A: automated verification (vendor evidence)

- Attach the CI run for the release commit: the `check` job (unit, integration, contract and science tests) and
  the `e2e` job (browser tests).
- Attach `docs/validation/TRACEABILITY.md` for the release, which links each requirement to its tests.

Record:
- the CI run URL;
- the commit;
- the result (all jobs passed);
- the reviewer and date.

## Part B: manual checks in your installation

Run the checks for the functions in your intended use. Remove the rows that are out of scope, and say why. Use
test users with the roles shown.

| # | Requirement (feature ID) | Steps | Expected result | Result | Evidence | Initials / date |
|---|---|---|---|---|---|---|
| OQ-1 | Access control (AUTH-02) | Sign in as a viewer of program A; open an experiment of program B by URL | Access denied; nothing from program B is shown | | | |
| OQ-2 | Reason for change (AUD-01) | As a contributor, edit a draft sample sheet and save | A reason is required; the audit log shows who, when, what changed, before/after and the reason | | | |
| OQ-3 | Re-authentication to publish (AUD-02) | Publish a version after the re-authentication window has passed | Sign-in is requested again before publishing | | | |
| OQ-4 | Immutability (REG-04) | Try to change a published version or a published release | The change is refused; a new version is needed | | | |
| OQ-5 | Audit trail completeness (AUD-01, AUD-02) | Filter the audit log on the actions of OQ-2 to OQ-4 and export it | Every action is present with UTC time and actor; the export is itself audited | | | |
| OQ-6 | Accurate copies (DS-*, REP-01) | Export a dataset release and an experiment report | The exported values match the release; the export is audited | | | |
| OQ-7 | Lineage (LIN-01) | Open the lineage of a published release | Files, run, release and version are linked | | | |
| OQ-8 | Deactivation (SCIM-04, if used) | Deactivate a test user in the IdP | Their sessions and tokens stop working at once | | | |
| OQ-9 | Data integrity on import (DS-01) | Import a file that breaks a quality rule | The release is rejected with the rule named; nothing is published | | | |
| OQ-10 | Calculations (ENR-03, QCD-01, …) | For the analyses in scope, compare results on a reference dataset with an independent calculation | Results agree within the stated tolerance | | | |

**Deviations:**

**Conclusion and approval:**
