# Migration Rollback Playbook — BANCO Store

**Status:** ⚠️ Partial — schema is **additive push mode** with idempotent boot patches; **no versioned SQL migrations** and **no automatic down-migrations**.

---

## How schema changes ship today

| Mechanism | Location | When it runs | Reversible? |
|-----------|----------|--------------|-------------|
| **Drizzle push** | `lib/db` → `pnpm run push` / `push-force` | Deploy script `deploy/aws/scripts/db-migrate.sh`, manual RC deploy | **Forward-only** |
| **Boot patches** | `lib/db/src/ensureSchema.ts` | Every api-server boot + vitest global setup | **Forward-only** (idempotent CREATE/ADD VALUE) |
| **Extension + indexes** | `artifacts/api-server/src/lib/bootstrap.ts` | After port bind, non-fatal on failure | **Forward-only** (indexes remain; safe to keep) |
| **Seeds** | `artifacts/api-server/src/seed*.ts` | Manual, once per fresh DB | **Manual undo** (delete rows) |

There are **zero** checked-in `drizzle/migrations/*.sql` files. History is the Drizzle schema in `lib/db/src/schema/` plus additive pushes.

---

## Boot patches (inventory)

### `ensureSchemaPatches()` — `lib/db/src/ensureSchema.ts`

| Change | SQL pattern | Rollback strategy |
|--------|-------------|-------------------|
| `upload_claims` table + indexes | `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` | **Keep** — required for upload IDOR fix (C-01). Roll back code, not table. |
| `notification_type` enum values | `ALTER TYPE … ADD VALUE IF NOT EXISTS` | **Irreversible** in PostgreSQL without dump/restore. Safe: old clients ignore new enum values. |

### `ensureDbExtensions()` + `ensureSearchIndexes()`

| Change | Rollback strategy |
|--------|-------------------|
| `CREATE EXTENSION pg_trgm` | Leave enabled — no downside |
| GIN trigram indexes on `listings`, `reference_*` | `DROP INDEX CONCURRENTLY` if needed — **search slows**, semantics unchanged |

---

## Drizzle push — operator classification

Before each release, classify schema diff:

| Class | Examples in this repo | Rollback |
|-------|----------------------|----------|
| **A — Additive** | New tables, nullable columns, new enum values, indexes | **Code rollback OK** — old code ignores new columns |
| **B — Widening** | Longer varchar, new optional JSON field | Code rollback OK |
| **C — Destructive** | DROP column/table, NOT NULL without default, type narrowing | **Requires RDS snapshot restore** — avoid in production |
| **D — Data backfill** | `seed`, `backfill:*` jobs | Re-run forward fix; undo only with targeted SQL |

**Project policy (observed):** only Class A/B have been used. `deploy/aws/scripts/db-migrate.sh` documents additive-by-default history.

---

## Forward deploy procedure

```bash
# 1. Snapshot BEFORE push (staging/prod)
#    AWS RDS: manual snapshot or rely on automated backup + PITR window
#    GCP Cloud SQL: on-demand backup

# 2. Apply schema
DATABASE_URL='postgresql://…' deploy/aws/scripts/db-migrate.sh
# or: pnpm --filter @workspace/db run push-force

# 3. Boot will re-run ensureSchemaPatches + indexes (idempotent)

# 4. Verify
node scripts/verify-upload-claims-schema.mjs
pnpm --filter @workspace/api-server test -- ensureSchema.test.ts
```

---

## Rollback procedures

### Scenario 1 — Bad **code** release, schema unchanged

1. Roll back API container/image to previous tag ([RELEASE-ROLLBACK-PLAYBOOK.md](./RELEASE-ROLLBACK-PLAYBOOK.md)).
2. **No DB action.**

### Scenario 2 — Bad **code** release after **additive** schema push

1. Roll back API to previous tag.
2. **Leave DB as-is** — extra columns/tables are harmless to old code.
3. Monitor for errors referencing missing columns (should not occur if release followed Class A/B).

### Scenario 3 — Destructive schema mistake (Class C)

1. **Stop writes** — drain API instances (`/api/readyz` 503 or scale to zero).
2. Restore DB from **pre-deploy snapshot** (RDS restore to new instance or PITR to timestamp).
3. Point `DATABASE_URL` to restored instance.
4. Deploy **previous known-good** API tag.
5. Post-mortem: never ship Class C without explicit migration plan.

### Scenario 4 — Enum value added, need to revert code only

- PostgreSQL cannot remove enum values easily.
- **Keep enum value**; revert application code that writes it.
- Old notification types unaffected.

---

## Staging verification checklist

- [ ] `pnpm --filter @workspace/db run push-force` against staging clone — exits 0
- [ ] `ensureSchema.test.ts` passes
- [ ] `uploadClaims.test.ts` passes (C-01)
- [ ] `MarketplaceLifecycle.e2e.test.ts` passes (publish path)
- [ ] Record snapshot ID / backup time in release notes

---

## What blocks global launch

| Blocker | Mitigation |
|---------|------------|
| No automated down-migration | Accept forward-only; use RDS PITR for disasters |
| `upload_claims` must exist on prod | Boot patch + one-time verify script |
| Enum additions irreversible | Only add values; never rename/remove in hot path |

**Publish lifecycle:** `ensureSchemaPatches` failures are **logged and non-fatal** on boot (`bootstrap.ts`) — server still binds port; upload claims may be missing until patch succeeds (run verify script).
