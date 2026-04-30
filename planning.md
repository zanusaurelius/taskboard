# Taskboard — Planning & Notes

## Stack
- **Next.js** (App Router) — frontend + backend API in one project
- **Prisma + SQLite** — database as a single file (`prisma/dev.db`), no Docker needed
- **Zustand** — state management (replaces Redux)
- **Material UI + dnd-kit + dayjs** — UI, drag-and-drop, dates

## Running locally
```bash
npm run dev              # starts on http://localhost:3000
npm run dev -- -p 3002   # start on a different port
```

## Feature parity vs donestreet version

| Feature | Donestreet | Taskboard |
|---|---|---|
| 4-column kanban (To Do / In Progress / Blocker / Done) | ✓ | ✓ |
| Drag and drop between and within columns | ✓ | ✓ |
| Sort by priority → due date → position | ✓ | ✓ |
| Overdue date highlighting (red) | ✓ | ✓ |
| Task: create / edit / delete / archive / unarchive | ✓ | ✓ |
| Task: duplicate | ✓ | ✓ |
| Task: title, description, stage, priority, due date | ✓ | ✓ |
| Task: assignee | ✓ | not included (no auth/users) |
| Project: create / rename / archive / unarchive | ✓ | ✓ |
| Filter by project | ✓ | ✓ |
| Filter by stage | ✓ | ✓ |
| Show/hide archived tasks | ✓ | ✓ |
| Show/hide archived projects | ✓ | ✓ |
| Task count badge on project chips | ✓ | ✓ |
| Text search across tasks | ✓ | ✓ |
| Columns scroll independently | ✓ | ✓ |
| Confirm dialog for archiving projects | ✓ | ✓ |

**Only missing:** assignee field — intentionally excluded since there's no user/auth system.
Can be added later as a simple free-text "assigned to" field if needed.

## Docker build (for Start9/self-hosting)

```bash
# Build the image
docker build -t taskboard .

# Run it (data and uploads persist in named volumes)
docker run -p 3000:3000 \
  -v taskboard-data:/app/prisma \
  -v taskboard-uploads:/app/data/uploads \
  taskboard
```

The container automatically runs `prisma migrate deploy` on startup before serving the app.
The SQLite database file lives in the `/app/prisma` volume so data survives container restarts.
Uploaded images live in `/app/data/uploads` (outside `public/`) and are served through the
authenticated `/api/uploads/[filename]` route — never publicly accessible without a session.

## Packaging for Start9 / StartOS
Still to do:
- Write `manifest.yaml` (app name, port, version, health check endpoint)
- Build and sign the `.s9pk` package using the Start9 SDK
- Add a `/health` API route for the Start9 health check

## Post-audit fixes (2026-04-30)

| # | Issue | Severity | Status |
|---|---|---|---|
| A1 | `auth.ts` returned `{}` instead of `null` on session invalidation — cookie never cleared | Critical | ✅ Fixed |
| A2 | `NotesView.tsx` used `typeof selectedFolder === "number"` — always false after CUID migration | Medium | ✅ Fixed |
| A3 | `account` PATCH/DELETE had no rate limiting (bcrypt brute-force vector) | Medium | ✅ Fixed |
| A4 | Dockerfile `COPY prisma.config.ts` — file doesn't exist, would fail Docker build | Low | ✅ Fixed |
| A5 | Project PATCH allowed empty-string name after trim | Low | ✅ Fixed |
| A6 | CSP `img-src` allowed `data:` URIs (not needed — uploads are served via `/api/uploads/`) | Low | ✅ Fixed |
| A7 | Upload cleanup ran file+DB delete concurrently — should delete DB record first | Low | ✅ Fixed |
| A8 | Task DELETE and project permanent DELETE didn't clean up embedded images | Medium | ✅ Fixed |

## Future ideas
- Assignees as free-text (no auth needed — just type a name)
- Due date reminders / notifications
- Multiple boards
- Keyboard shortcuts (N = new task, etc.)
- CSP nonce-based policy ✅ implemented (script-src now uses nonce + strict-dynamic; style-src still uses unsafe-inline for MUI/Emotion)

---

## Security & Privacy fixes (audited 2026-04-30)

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Project PATCH mass assignment (raw body → Prisma) | Critical | ✅ Fixed |
| 2 | Upload route had no auth check (relied on middleware alone) | Critical | ✅ Fixed |
| 3 | Upload accepted any file type (no MIME/magic bytes check) | Critical | ✅ Fixed |
| 4 | Uploaded files publicly accessible (served from `public/uploads/`) | Critical | ✅ Fixed |
| 5 | Task PUT allowed moving tasks to other users' projects | High | ✅ Fixed |
| 6 | Note create/update didn't validate projectId/folderId ownership | High | ✅ Fixed |
| 7 | Recovery code not invalidated/rotated after use | High | ✅ Fixed |
| 8 | No rate limiting on auth endpoints (login, register, recover) | High | ✅ Fixed |
| 9 | No session invalidation after password change | High | ✅ Fixed |
| 10 | `dev.db` not in `.gitignore` | High | ✅ Fixed |
| 11 | No security headers (CSP, X-Frame-Options, nosniff, etc.) | Medium | ✅ Fixed |
| 12 | No file size limit on uploads | Medium | ✅ Fixed |
| 13 | Sequential integer IDs leak data volume | Medium | ✅ Fixed (→ CUID) |
| 14 | `next/font/google` external network call | Medium | N/A — self-hosts at build time, no runtime Google requests |
| 15 | Uploaded images never cleaned up (no DB tracking) | Medium | ✅ Fixed |
| 16 | No account deletion | Medium | ✅ Fixed |
| 17 | Upload filename used `Math.random` (not cryptographically random) | Low | ✅ Fixed |
| 18 | `userId` nullable on all models (orphaned data mechanism) | Low | ✅ Fixed (non-nullable) |
| 19 | First-user privilege escalation (auto-claims orphaned data) | Low | ✅ Fixed (removed) |
| 20 | `next-auth` beta version in production | Low | Tracked — upgrade when stable |

## Second-pass security hardening (2026-04-30)

**⚠️ After pulling these changes run:** `npx prisma migrate dev` (dev) or `npx prisma migrate deploy` (prod) to apply the new `RateLimit` and `AuditLog` tables and the `Upload.size` column.

| # | Issue | Severity | Status |
|---|---|---|---|
| H1 | `proxy.ts` ignored by Next.js — auth middleware never ran | Critical | ✅ Fixed → `middleware.ts` |
| H2 | CSP `script-src 'unsafe-inline'` defeated XSS protection | High | ✅ Fixed → nonce + strict-dynamic |
| H3 | Rate limit IP spoofable via first `X-Forwarded-For` entry | High | ✅ Fixed → prefer `x-real-ip`, use rightmost XFF |
| H4 | No upload rate limit or per-user storage quota | High | ✅ Fixed → 20/hr, 500 MB quota (env: `UPLOAD_QUOTA_BYTES`) |
| H5 | Timing oracle: username existence leaked via bcrypt skip on recovery | High | ✅ Fixed → dummy bcrypt compare |
| H6 | Real user files in `public/uploads/` served without auth | Medium | ✅ Fixed → moved to `data/uploads/`, directory removed |
| H7 | In-memory rate limiter reset on restart / bypassed in multi-instance | Medium | ✅ Fixed → Prisma-backed SQLite |
| H8 | No input size limits on any API endpoint | Medium | ✅ Fixed → `lib/constants.ts` limits enforced everywhere |
| H9 | Upload deletion didn't check if other notes/tasks referenced the file | Medium | ✅ Fixed → ref-check before delete in notes, tasks, projects |
| H10 | Orphaned uploads from abandoned editor sessions | Medium | ✅ Fixed → background cleanup on each upload POST |
| H11 | Missing COOP + CORP headers | Low | ✅ Fixed → `same-origin` on both |
| H12 | `X-XSS-Protection` deprecated/harmful | Low | ✅ Fixed → removed |
| H13 | No audit logging | Low | ✅ Fixed → `lib/audit.ts` + `AuditLog` table |
| H14 | `SameSite=Lax` cookie (Strict is better for self-hosted) | Low | ✅ Fixed → `SameSite=strict` |
| H15 | No `AUTH_SECRET` entropy guard | Low | ✅ Fixed → throws if < 32 chars |
| H16 | Permissions-Policy incomplete | Low | ✅ Fixed → added payment, usb, serial, bluetooth, display-capture |

## Deferred security/privacy items (2026-04-30)

| # | Item | Notes |
|---|---|---|
| D1 | SQLite encryption at rest | Consider SQLite Encryption Extension (SEE), Postgres with TDE, or ensuring the host volume is on an encrypted filesystem (e.g. LUKS). Low-hanging fruit: confirm the Docker volume is on an encrypted block device. |
| D2 | Stronger password requirements | Currently: 8-char minimum only. Options: add zxcvbn-style strength meter client-side; reject top-1000 common passwords server-side; require mixed case + digit. Intentionally deferred. |
| D3 | Re-evaluate 10 MB upload limit | Current per-file limit is 10 MB; per-user quota is 500 MB (configurable via `UPLOAD_QUOTA_BYTES` env var). Revisit once actual usage patterns are known — may want to lower per-file or raise/lower total quota. |
| D4 | SameSite=strict cookie caveat | Changed from Lax to Strict. Side effect: navigating to the app from an external link (e.g. email, bookmark app) won't send the session cookie → user appears logged out and is redirected to /login. Acceptable for a self-hosted personal app but worth noting if sharing links becomes common. |
| D5 | Persistent AuditLog growth | AuditLog table grows indefinitely. Add a periodic cleanup job (e.g. `DELETE WHERE createdAt < NOW() - 90 days`) or cap via a cron/housekeeping route. |
| D6 | Orphaned uploads from public/uploads/ | Files moved to `data/uploads/` during security hardening have old timestamp-based names. The `/api/uploads/[filename]` route rejects them (regex mismatch). Consider a one-time migration script if those images are needed. |
