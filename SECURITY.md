# Security policy

## Reporting a vulnerability
Please **do not open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository (GitHub private vulnerability reporting).
Include the affected version or commit, the steps to reproduce, and the impact.

- **Acknowledgement:** within 3 working days.
- **Assessment:** within 10 working days.
- **Fix:** we agree a disclosure date with you once a fix is ready.

## Supported versions
Security fixes go to the latest release and `main`.

## Scope notes
- **Public demo instances** (`DEMO_MODE=true`) publish low-privilege demo logins on purpose and hold only
  synthetic data. Reports about the demo logins themselves are out of scope. Reports about escalating from them
  are in scope.
- **Self-hosted deployments** are configured by their operators. See `docs/DEPLOY_RENDER.md` for the expected
  settings: HTTPS, generated secrets, and the Keycloak admin console not exposed.
