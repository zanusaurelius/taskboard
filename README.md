# Taskboard

A self-hosted productivity app with a Kanban task board, rich-text notes, daily journal, habit tracker, and file gallery. Runs as a single Docker container — your data stays on your hardware.

<img width="1900" height="930" alt="Screenshot 2026-06-06 at 8 45 24 PM" src="https://github.com/user-attachments/assets/c30d2060-e186-478d-a39d-f782593c5fb8" />
<img width="1900" height="922" alt="Screenshot 2026-06-06 at 8 45 47 PM" src="https://github.com/user-attachments/assets/0e988046-4984-4bfd-9b89-503cdb854977" />
<img width="1909" height="930" alt="Screenshot 2026-06-06 at 8 46 07 PM" src="https://github.com/user-attachments/assets/fe5d0147-7de8-4d81-9d2a-facf73f42dd0" />




## Features

- **Kanban board** — drag-and-drop tasks across To Do / In Progress / Blocked / Done, with priorities, due dates, and per-project color coding
- **Rich-text notes** — full formatting, folder organization, pin/star, and per-note or per-project grouping
- **Daily journal** — one entry per day with a body, gratitude line, and a note to your future self
- **Habit tracker** — daily habits with streak history displayed on the board
- **Daily focus** — top goals for the day, linked to tasks or free-form
- **File gallery** — upload and browse files in a folder tree with grid/list view
- **Global search** — search across tasks, notes, and files in one place
- **React Native mobile app** — iOS and Android, offline-capable with background sync
- **Theming** — light, dark, and system modes on both web and mobile

## Tech stack

| Layer | Tech |
|---|---|
| Web frontend | Next.js 16, React 19, MUI v6 |
| Mobile | React Native (Expo) |
| Backend | Next.js API routes |
| Database | SQLite via Prisma + better-sqlite3 |
| Auth | NextAuth (JWT sessions) + bcrypt |
| Deployment | Docker, self-hostable on any Linux server |

## Running locally

```bash
# Install dependencies
npm install

# Set up the database
npx prisma migrate deploy

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and create an account.

### Seed demo data

To populate an account with example projects, tasks, notes, journal entries, habits, and files:

```bash
# Seeds the first user in the database
npx tsx prisma/seed.ts

# Seed a specific user (will create it if it doesn't exist)
npx tsx prisma/seed.ts demo

# Wipe and re-seed
npx tsx prisma/seed.ts demo --force
```

## Docker deployment

```bash
docker build -t taskboard .
docker run -p 3000:3000 \
  -v taskboard-db:/app/prisma \
  -v taskboard-uploads:/app/data \
  -e AUTH_SECRET=your-secret-here \
  taskboard
```

`AUTH_SECRET` must be at least 32 characters. Generate one with `openssl rand -hex 32`.

Data is stored in two volumes — the SQLite database and uploaded files — and both survive container updates.

## Mobile app

The React Native app lives in `mobile/`. It connects to your self-hosted server over the network — enter your server URL at the login screen.

```bash
cd mobile
npm install

# Run on Android emulator
npx expo run:android

# Run on iOS simulator
npx expo run:ios
```

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `AUTH_SECRET` | Secret for signing session tokens | required |
| `DATABASE_URL` | Path to SQLite database | `file:./dev.db` |
| `UPLOAD_QUOTA_BYTES` | Per-user file storage limit | 10 GB |

## License

MIT
