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

---

## Deployment & distribution analysis (2026-05-05)

### Goal
Self-hosted personal productivity app, accessible from Android phone, privacy-focused.

### PWA vs native APK

The app already has `public/sw.js` (service worker), so PWA groundwork exists. Adding a `public/manifest.json` + two icon sizes is all that's needed to make it installable from Chrome on Android ("Add to Home Screen" → fullscreen, appears in app drawer).

**Capacitor** (real APK) is a half-day conversion from a working PWA — Capacitor wraps the same web code in a native WebView shell. Low risk to defer until PWA hits a real limitation.

**Offline support:** not viable without significant extra work (IndexedDB + background sync + conflict resolution). At 200-300 notes the fetch-all-decrypt-filter approach for search is fast enough — a few MB, milliseconds on device. Offline is not worth the architectural complexity for a personal app.

### Hosting options compared

| Option | Cost | Data location | Clearnet access | Privacy | Notes |
|---|---|---|---|---|---|
| Vercel + Neon/Supabase | Free | Third-party servers | ✓ built-in | Poor — multiple parties can read plaintext data | Easiest to deploy |
| DigitalOcean droplet | ~$6/mo | Their datacenter, your server | ✓ built-in | Good — only you have server access | Recommended if paying |
| Oracle Cloud Free Tier | Free | Their datacenter | ✓ built-in | Worse than DO — Oracle is a data broker | Termination risk (see below) |
| Fly.io | Free (limited) | Their datacenter | ✓ built-in | Similar to DO | Resource limits tighten with use |
| Railway | Free trial only | Their datacenter | ✓ built-in | Similar to DO | ~$5/mo after trial |
| Home server + Tailscale | Free (after hardware) | Your hardware | ✓ via Tailscale mesh | Best — data never leaves home | Machine must stay on |
| Home server + Cloudflare Tunnel | Free (after hardware) | Your hardware | ✓ via Cloudflare | Very good — home IP hidden | Machine must stay on |
| Start9 EmbassyOS | Free (after hardware) | Your hardware | Tor only by default | Best | Clearnet needs port forwarding + domain |

### Oracle Cloud Free Tier — why to avoid

- Oracle has done mass terminations of free accounts with little/no warning
- Terms explicitly allow reclaiming free resources at any time
- "Idle" detection is opaque — active instances have been terminated
- Core business includes Oracle Data Cloud, one of the largest data brokers in the world
- Ironic choice for a privacy-focused app

### Start9 EmbassyOS — status

Sideloading a `.s9pk` file is easy (UI file upload). Building the `.s9pk` is significant work:
- Dockerfile, `manifest.yaml`, start-sdk build pipeline
- Persistent volume setup for SQLite + uploads
- Run `prisma migrate deploy` in init script
- Config inputs for secrets (AUTH_SECRET etc.)

Remote access defaults to Tor (.onion) — works anywhere but slow (2-5s page loads). Clearnet requires domain + port forwarding + dynamic DNS. Not worth the complexity given other options.

### Mobile app — research findings (2026-05-24)

#### Current approach: Tor Browser + Orbot (zero dev work)
The app is accessible today via `.onion` address through Tor Browser for Android with Orbot in VPN mode. This is Start9's own documented recommendation for Android. Try this first before building anything.

#### If Tor Browser UX is not good enough: build a TRUE native app

**Do not build a WebView wrapper / browser wrapper.** A WebView APK is functionally equivalent to Tor Browser — it is still just a browser loading a server-rendered page, just without the browser chrome. Not worth the effort.

**How apps like Bitwarden and Element are actually built:**
- Bitwarden (2024): fully native Swift (iOS) + Kotlin/Android. No WebView. Migrated from Xamarin/.NET MAUI.
- Element X (Android): fully native Kotlin + Jetpack Compose UI + Rust SDK for Matrix protocol.
- Both are **pure API clients** — they consume REST/Matrix APIs and render the entire UI natively.

**Why this app can't do the same without work:**
The taskboard is server-rendered (Next.js). The UI is generated on the server. A true native mobile app would need to consume the existing REST API routes (`/api/tasks`, `/api/notes`, etc.) and rebuild every screen natively — kanban board, rich text editor, journal, settings, vault. That is weeks of work but it is the right path if mobile is a priority.

**What NOT to suggest for mobile:**
- PWA via browser (still a browser)
- Capacitor / WebView APK (browser wrapper — same experience as Tor Browser, not a native app)
- GeckoView APK (still a browser wrapper, just using Firefox's engine)
- Any approach that wraps the web app in a WebView shell

**If building native mobile:**
- Android: Kotlin + Jetpack Compose, consuming the existing REST API
- iOS: Swift + SwiftUI, consuming the existing REST API
- Or: React Native (single codebase, TypeScript, consumes REST API — reuses language familiarity)
- Privacy: Orbot VPN mode routes all traffic through Tor transparently — no special Tor integration needed in the app itself

**Start9 ecosystem note:**
- iOS has "Start9 Consulate" — a custom bare-bones browser for `.onion`/`.local` URLs (essentially a WebView wrapper)
- Android has NO equivalent from Start9 — their docs just say use Firefox + Orbot
- Building a true native Android/iOS app for this taskboard would be more valuable than a Consulate-style wrapper

#### Decision
Try Tor Browser + Orbot first. If the experience is unsatisfactory, the next step is a true native React Native or Kotlin app — not a WebView wrapper.

---

### Recommended approach: DigitalOcean + E2E encryption + PWA

**Why:**
- $6/mo is the only recurring cost — reasonable for a daily-use personal app
- Only you have server access (vs Vercel/Neon where multiple parties do)
- E2E encryption makes the host largely irrelevant — they only ever see ciphertext
- PWA gives a good phone experience with minimal extra work
- Clearnet by default, no Tor latency, no port forwarding

**E2E encryption plan:**
- Vault (`lib/vault-crypto.ts`) already implements client-side encryption via Web Crypto API
- Extend the same pattern to note content, task titles/descriptions
- Server stores encrypted blobs; key never leaves the device
- Key derived from vault password (one password unlocks everything — Standard Notes model)
- Unencrypted metadata (timestamps, IDs, ordering, project membership) is an acceptable leak for personal use
- Search: fetch all → decrypt client-side → filter. Fast at 200-300 notes

**Migration from SQLite to Postgres:**
- Change `provider` in `prisma/schema.prisma` from `sqlite` to `postgresql`
- Update `DATABASE_URL` env var
- Everything else (API routes, auth, vault) works as-is

### Revised conclusion: E2E makes free hosting viable

If E2E content encryption is implemented properly, the host can't read your data regardless of who they are. This makes **Vercel + Neon (free) + E2E** a genuinely reasonable choice — not just a compromise.

Remaining differences vs self-hosted (all minor for a personal app):
- **Metadata leaks** regardless of E2E — usage times, frequency, record counts, blob sizes visible to host
- **JS integrity trust** — you have to trust Vercel serves unmodified JS. A compromised deploy could exfiltrate keys before encryption. Unlikely but real attack vector for a personal app.
- **Attack surface** — Vercel + Neon + CDN is three parties; a single self-hosted server is one

For a personal productivity app: **Vercel + E2E is fine.** Self-hosting is better but the gap is small once E2E is in place.

### Cloudflare Tunnel into Start9 EmbassyOS

Possible but not clean. Start9 is a managed OS so `cloudflared` can't run as a loose process. Options:
- Package cloudflared as a sideloaded Start9 service (community has done this, not official)
- Run cloudflared on a second device on the same LAN, tunnel to the Embassy's local IP
- Wait — Start9 is actively adding more clearnet options in newer StartOS versions

### Final hosting decision matrix

| Want | Best option |
|---|---|
| Free + no hardware + private enough | Vercel + Neon + E2E encryption |
| Best privacy, own hardware, clearnet | Home server + Cloudflare Tunnel |
| Best privacy, own hardware, okay with Tor | Start9 EmbassyOS |
| Paid, simplest managed server | DigitalOcean (~$6/mo) |
