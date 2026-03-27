# Release Log

## 2026-03-26

- env: production/staging
- migration_version: m001
- scope:
  - auth + token lifecycle hardening
  - login/refresh rate limit
  - helmet security headers
  - audit meta for key write APIs
  - JSON log standard fields (`traceId/requestId/userId/role`)
  - browser e2e flow (admin approve/reject + h5 submit)
  - deploy auto rollback on continuous health check failure
- tag naming:
  - predeploy: `predeploy-{env}-{yyyymmdd-HHMMSS}`
  - deploy ok: `deploy-ok-{env}-{yyyymmdd-HHMMSS}-{migration_version}`
