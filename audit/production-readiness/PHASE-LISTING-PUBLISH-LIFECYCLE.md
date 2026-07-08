# Phase — Listing publish lifecycle

**Verdict: publish safe** for this consolidation release.

## What “publish safe” means here

The listing **publish** lifecycle (draft → validation → publish → visibility on feed/search) must not regress. This pass intentionally avoided:

- Publish/submit API handlers and route contracts
- Listing state machine or moderation gates
- Feed/search ranking or algorithm changes

## Files touched in consolidation (performance / resilience only)

| Area | Files | Risk to publish |
|------|--------|-----------------|
| Home tab | `app/(tabs)/index.tsx` | None — UI/perf |
| Search tab | `app/(tabs)/search.tsx`, `SearchResultsMap.tsx`, `useSearchMiniApp.ts` | None — read/search UX |
| Session | `context/SessionContext.tsx` | Low — auth/session stability; no publish API changes |

## Pre-flight checklist (staging)

1. Create listing draft → fill required fields → **Publish** → confirm 2xx and listing visible on profile.
2. Unpublish/archive if supported → confirm state on API.
3. Repeat on slow network (airplane mode toggle) — session recovery must not corrupt draft.

## Rollback

If publish fails after mobile-only deploy: roll back EAS build; API rollback per `RELEASE-ROLLBACK-PLAYBOOK.md` only if API was deployed.

## Sign-off

- **Consolidation agent:** No publish-path diffs identified in scope above.
- **Required human sign-off:** Staging publish smoke on real device before production GO.
