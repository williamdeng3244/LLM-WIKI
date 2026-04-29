---
tags:
- auth
- security
title: Authentication (copy)
---

# Authentication

Users authenticate via OIDC against our IdP. The backend validates the ID token, issues a session JWT, and stores nothing about the password.

## Flow

1. User clicks Sign in → redirected to IdP
2. IdP returns to `/auth/callback` with an authorization code
3. Backend exchanges the code for an ID token, validates signature and claims
4. Backend issues an HS256-signed session JWT with sub, email, role
5. Subsequent requests carry the JWT in `Authorization: Bearer ...`

## API tokens

Personal API tokens are bcrypt-hashed; the raw token is shown to the user once at creation. See [[engineering/api-tokens]] for the lifecycle and rotation policy. Agents use the same token mechanism — see [[product/personal-agents]] for the user-facing model.

## Stub mode

In development, headers `X-User-Email` and `X-User-Role` auto-create a user. Never deploy with `AUTH_MODE=stub`. See [[operations/deployment-checklist]].

#auth #security