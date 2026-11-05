# 0031 — SCIM 2.0 provisioning alongside OIDC sign-in
Date: 2026-11-05 · Status: accepted
## Context
- **The need:** customers' IT teams manage joiners and leavers in their identity provider. Without provisioning, a
  leaver keeps access until their session or tokens expire, and users only exist after their first sign-in.
- **Constraints:**
  - Sign-in stays OIDC.
  - Roles still come from group mappings.
  - Soft delete only.
  - Every change is audited.
  - No dependency.
## Decision
- **Endpoints:** SCIM 2.0 (RFC 7643/7644) at `/scim/v2`.
  - ServiceProviderConfig, ResourceTypes, Schemas, Users and Groups.
  - `eq` filters on the attributes IdPs look up, 1-based paging, PUT, PATCH and DELETE.
  - Errors in SCIM's format and `application/scim+json`.
  - SCIM is an external protocol, so it is outside `/v1` and the OpenAPI contract, as MCP already is.
- **Authentication:** a system admin's token with the new `scim` scope.
  - That scope is alone on its token and gives no `/v1` or MCP access.
  - The token's owner must still be a system admin on every request.
  - Changes are audited as that admin, with the reason "SCIM provisioning".
- **Users:**
  - A provisioned user gets a placeholder `sub` (`scim:…`). Their first OIDC sign-in links to them by email,
    case-insensitive, and only unlinked SCIM accounts are matched. The same IdP vouches for both.
  - `active: false` sets `deactivated_at`: every session and token stops working at once, and it is reversible.
    DELETE is a soft delete.
  - Entra ID's string booleans are accepted.
- **Groups:** groups are `app_group` rows. Members are `group_member` rows with `source = 'scim'`. Sign-in's groups
  claim changes only `source = 'login'` memberships, so the two never undo each other. Roles follow from the
  existing group mappings.
## Consequences
- Not supported: bulk operations, sorting, ETags, complex filters (`and`/`or`, `co`, `sw`) and enterprise
  extension attributes. IdPs fall back to the supported subset, and unsupported filters get a clear
  `invalidFilter`.
## Revisit when
An IdP integration needs another filter or attribute, or customers want SCIM-managed program roles directly.
