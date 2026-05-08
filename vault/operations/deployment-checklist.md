---
tags:
- ops
- runbook
title: Deployment checklist
---

# Deployment checklist

Before production:

- [ ] `AUTH_MODE=oidc` (NOT stub)
- [ ] `JWT_SECRET` is a random 32+ char string from a password manager
- [ ] `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` set
- [ ] OIDC issuer, client_id, client_secret configured
- [ ] Postgres has nightly backups
- [ ] Default admin password rotated (see [[engineering/authentication]])
- [ ] CORS origins set to actual frontend domain
- [ ] HTTPS termination at the load balancer

## After deploy

- [ ] Verify `/api/health` returns ok
- [ ] Run `scripts/git-export.sh` once to confirm export works
- [ ] Sign in as an admin and create a test page
- [ ] Promote at least one editor per category — see [[operations/permissions]]

#ops #runbook