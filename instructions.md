# Taskboard Notes

A personal kanban board and notes app that runs entirely on your Embassy.

## First-time setup

1. Go to **Config** and set a strong **Authentication Secret** (at least 32 characters).
   You can generate one with: `openssl rand -hex 32`
2. Save the config and start the service.
3. Open the **Web UI** interface and register your account.

## Features

- 4-column kanban board (To Do / In Progress / Blocker / Done)
- Folder-based rich-text notes
- Daily focus / habit tracker
- End-to-end encrypted vault for sensitive notes
- Image uploads (stored on your Embassy, never leaves your hardware)

## Accessing from your phone

The service is accessible via Tor. Install **Tor Browser** or use **Orbot** with
your preferred browser on Android. Navigate to the `.onion` address shown in
the Interfaces section.

## Backups

Backups capture the SQLite database (all tasks, notes, projects) and uploaded
images. Restore from a backup to recover your data after a reinstall.

## Data location

- Database: persisted in the `db` volume (`/app/prisma/`)
- Uploaded images: persisted in the `uploads` volume (`/app/data/uploads/`)

Both volumes survive service updates and are included in Embassy backups.
