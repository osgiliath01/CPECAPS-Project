# CPECAPS Project — Changes (October 30–31, 2026)

This document describes every change made to the Calamba Allied Industrial Corporation voucher system on October 30–31, 2026: what was added, how each feature behaves, the database and API changes, and how to test them.

**Contents**

1. [Summary](#1-summary)
2. [Running the project](#2-running-the-project)
3. [Roles and permissions](#3-roles-and-permissions)
4. [Features](#4-features)
   - 4.1 Superadmin account
   - 4.2 Admin-only actions
   - 4.3 Change requests (archive and edit)
   - 4.4 Archiving (soft delete)
   - 4.5 Project archiving
   - 4.6 Automatic permanent deletion after 30 days
   - 4.7 Activity Log
   - 4.8 Password reset from the login page
   - 4.9 User management
   - 4.10 Interface fixes
   - 4.11 CSV import
   - 4.12 Live updates
   - 4.13 Edit-conflict protection
5. [Database changes](#5-database-changes)
6. [API reference](#6-api-reference)
7. [Activity Log action reference](#7-activity-log-action-reference)
8. [File-by-file changes](#8-file-by-file-changes)
9. [Settings you can change](#9-settings-you-can-change)
10. [Testing checklist](#10-testing-checklist)
11. [Known issues and follow-ups](#11-known-issues-and-follow-ups)

---

## 1. Summary

| Area | Before | After |
|---|---|---|
| Deleting an entry | Anyone signed in could permanently delete any entry | Entries are **archived** (hidden). Only admins archive directly; normal users send a request |
| Editing an entry | Anyone could edit any entry; only the last editor was kept | Only admins edit directly. Normal users send an **edit request**. Every edit is logged with old → new values |
| Projects | Could not be removed | Admins can **archive** a project together with all its entries |
| Archived items | — | Restorable for **30 days**, then **deleted permanently** by the backend |
| History | None | **Activity Log** records every action, kept forever |
| Forgotten password | No way to recover | **Forgot password?** on the login page; an admin approves and hands over a temporary password |
| Accounts | Managed only through the database | **Manage users** screen: rename, change role, deactivate, reset password, delete |
| Admin role | Existed in the database but the app ignored it | Enforced by the backend on every protected route and shown in the interface |
| Import File | Disabled | Admins import entries from CSV, with a preview and per-row validation |
| Other people's changes | Only visible after reloading the page | Appear automatically within ~2 seconds |
| Two people editing at once | Last save silently won | Outdated edits and approvals are refused with a clear message |
| Backend | Each teammate ran their own copy | **One shared backend** next to the database (Docker) |

---

## 2. Running the project

There is now **one shared backend** for the whole team, running in Docker on the same machine as the database (`database.nyala-ordinal.ts.net`). Everyone's app talks to it, so everyone sees the same data, live updates work, and the 30-day purge runs in exactly one place.

### On the database machine (once, and after each update)

From the `Backend` folder, with Docker running:

```bash
git pull
docker compose up -d --build     # starts/updates the database (db) and the backend (api)
docker compose logs -f api       # optional: watch the backend's output
```

- The backend listens on port **8000**: http://database.nyala-ordinal.ts.net:8000/docs
- It connects to the database inside Docker (`db:5432`), and upgrades the database by itself on start (see [section 5](#5-database-changes)).
- First time only, create the default admin: `docker compose exec api python main.py`

### On each teammate's computer

Only the frontend runs locally. Point it at the shared backend once:

```powershell
cd Frontend
copy .env.example .env.local      # sets VITE_API_URL to the shared backend
npm install
npm run dev
```

You must be connected to **Tailscale** to reach the shared backend. Signing in works the same as before.

### Running a backend locally (development only)

Only when changing backend code. Use a test copy of the database if you can, and stop it when you're done:

```powershell
cd Backend
..\venv\Scripts\activate
uvicorn auth:app --reload --timeout-graceful-shutdown 3
```

and temporarily point your frontend at it with `VITE_API_URL=http://localhost:8000` in `.env.local`. The `--timeout-graceful-shutdown 3` keeps reloads fast, since live-update connections stay open.

- API docs (Swagger): `/docs` on whichever backend you use
- App: the URL printed by `npm run dev` (usually http://localhost:5173)

## 3. Roles and permissions

There are two roles. A user's role is stored in `users.is_superuser`.

| Action | Normal user | Admin |
|---|:-:|:-:|
| Sign in, register, change own password | ✓ | ✓ |
| View projects and entries | ✓ | ✓ |
| Create projects, add entries | ✓ | ✓ |
| Edit an entry | Request only | ✓ directly |
| Archive an entry | Request only | ✓ directly |
| Archive / restore a project | — | ✓ |
| See own requests and their outcome (**My requests**) | ✓ | — |
| Approve / reject requests (with an optional note) | — | ✓ (not their own) |
| Approve / reject password resets | — | ✓ (not their own) |
| Restore archived entries and projects | — | ✓ |
| Activity Log | — | ✓ |
| Manage users | — | ✓ |

**How it's enforced.** The backend checks permissions on every request using two dependencies in `security.py`:

- `get_current_user` — any signed-in, active user who is **not** on a temporary password.
- `get_current_superuser` — the above, plus `is_superuser`. Non-admins get `403 Only admins can do this.`

Role changes take effect on the server immediately, because the role is read from the database on each request. The interface reads the role from the sign-in token, so a user sees their new menu after signing in again.

Hiding buttons in the frontend is only for convenience. Calling an admin route directly, through Swagger or curl, is still refused.

---

## 4. Features

### 4.1 Superadmin account

`database.init_db()` (run by `python main.py`) creates a default admin:

- **Username / password:** `admin` / `admin123`. Change it right after the first sign-in.
- If an account named `admin` already exists but isn't an admin (for example, someone registered it through the app), it is **promoted** instead of causing a duplicate-username error.
- Accounts made through **Create account** are always normal users.

### 4.2 Admin-only actions

- `DELETE /disbursements/{id}` (archive) and `PATCH /disbursements/{id}` (edit) are admin-only.
- The sign-in token now includes `name`, `is_superuser` and `must_change_password`. The frontend reads these in `api.js → me()`.
- The user menu shows **Admin** for admins.

### 4.3 Change requests (archive and edit)

Normal users can't archive or edit entries directly. They send a request, and an admin decides.

**Requesting (normal user):**

- **Request archive** (table button) asks for a **reason** (required, at least 3 characters).
- **Request edit** opens the usual form, titled **Request changes**, with an optional **Reason**. Only the fields that actually changed are sent. Nothing changes in the table until the request is approved.
- Each entry can have only **one pending request** at a time, whether archive or edit.

**Reviewing (admin), in Activity Log → Requests:**

- Each request is tagged **Archive** or **Edit**. Edit requests show exactly what would change, e.g. `Amount: ₱12,000.00 → ₱12,310.00`.
- An optional **Note to requester** can be typed before clicking **Approve** or **Reject**.
- Approving an edit applies the new values and records the **requester** as the editor. Approving an archive archives the entry.
- An admin can't review their own request (shown as "Yours").

**Seeing the outcome (normal user), in My requests:**

- Lists every request they've sent: type, entry, what they asked, status (**Pending / Approved / Rejected**), the admin's note, who decided and when.

**Automatic rejection.** If a project is archived while its entries have pending requests, those requests are rejected with the note *"The whole project was archived."*

Requests are stored in the `deletion_requests` table. The name was kept for compatibility; the `request_type` column says `archive` or `edit`.

### 4.4 Archiving (soft delete)

Entries are no longer erased when "deleted":

- Archived entries disappear from the project, from Voucher Control and from every total.
- An archived entry can't be edited, and can't receive new requests.
- Admins restore entries in **Activity Log → Archived → Entries**.
- The old hard-delete function in `crud.py` was removed, so nothing in the code can erase an entry directly. Only the 30-day purge removes data (see 4.6).

### 4.5 Project archiving

- Admins see an **Archive** button on each project in Voucher Control. The confirmation states how many entries and how much money go with it.
- Archiving a project archives all of its active entries together. They are marked `archived_with_project`.
- Entries that were archived on their own **before** the project stay separately archived.
- Restoring a project (**Activity Log → Archived → Projects**) brings back exactly the entries archived with it.
- An entry inside an archived project can't be restored on its own. Restore the project instead.
- While a project is archived, nobody can create a project or add an entry with the same title. The error message explains that it's archived and can be restored.

### 4.6 Automatic permanent deletion after 30 days

- Anything archived for more than **30 days** (single entries, or projects together with their entries) is **deleted permanently**.
- The backend runs this check at startup and then **every hour** (`purge_once` in `auth.py`, `purge_expired` in `activity.py`).
- Each deletion writes a **Deleted permanently** row to the Activity Log containing a copy of the removed data: project title, entries with date, CV no., payee and amount, and who archived it and when.
- The Archived tab shows a countdown for each item ("23 days left"), in red during the last 7 days. Hovering shows the exact deletion date and time.
- If several copies of the backend run at once, they may try to purge the same rows. A failed attempt is rolled back and skipped, so this is safe.

> **Record retention:** financial records are gone for good 30 days after archiving, apart from the copy kept in the Activity Log. Check whether your organization has a longer retention requirement for vouchers.

### 4.7 Activity Log

An admin-only window (top-bar button **Activity Log**) with four tabs:

| Tab | Contents |
|---|---|
| **Activity** | Every recorded action, newest first, 50 per page. Filters: **Record type** (Entries / Projects / Accounts), **Action**, **User**, and a text search. Edits show old → new values; requests and reviews show the reason and the admin's note |
| **Archived** | Archived **Projects** and **Entries**, each with its countdown and a **Restore** button |
| **Requests** | Pending archive and edit requests, with note fields and Approve / Reject |
| **Password resets** | Pending forgotten-password requests (see 4.8) |

The log is stored in the `activity_logs` table and is never purged. Each row has: time, actor (username, or `system` for automatic actions), action, record type and ID, a readable summary, and a `details` JSON field with the before/after values, reasons and notes. Every action is listed in [section 7](#7-activity-log-action-reference).

### 4.8 Password reset from the login page

Accounts have no email address, so resets are approved by an admin:

1. On the login page, **Forgot password?** opens **Reset password**. The user enters their username and an optional message.
   - The reply is always the same (*"If that account exists, an admin will review your request…"*), so the form can't be used to find out which usernames exist.
   - Attempts with unknown usernames are still logged.
2. An admin opens **Activity Log → Password resets** and clicks **Approve**. A one-time **temporary password** appears, with a **Copy** button.
   - It is 10 characters long and avoids look-alike characters (0/O, 1/l/I).
   - It is never stored in plain text and never logged. It can't be shown again.
   - An admin can't approve a reset of their own account.
3. The user signs in with the temporary password and sees **Set a new password** instead of the dashboard. Saving signs them straight in.
   - The backend enforces this: every route except change-password answers `403` until the temporary password is replaced (`users.must_change_password`).

**Change password** in the user menu works exactly as before.

### 4.9 User management

Admins open **Manage users** from the user menu (top right).

- **The list:** name, username, role, status (Active / Deactivated, plus "Temporary password" when relevant) and **last sign-in** (taken from the Activity Log). Searchable.
- **Manage** opens these controls for one account:
  - **Save name**
  - **Make admin / Remove admin**
  - **Deactivate / Reactivate** — blocks sign-in but keeps the account and history. A deactivated user who is already signed in is signed out on their next action (the backend answers `401`).
  - **Reset password** — immediate temporary password, no request needed. Any pending forgot-password request for that account is marked handled.
  - **Delete account** — permanent. You must type the username to confirm. Entries, requests and logs keep the username they were recorded with.

**Safety rules, enforced by the backend:**

- Admins can't delete, deactivate or demote themselves, or reset their own password here.
- The **last active admin** can't be demoted, deactivated or deleted.

Deactivating is usually better than deleting: if a deleted username is registered again later, old entries would appear to belong to the new person.

### 4.10 Interface fixes

- **Focus ring:** keyboard focus is now yellow (`#ffbc13`) everywhere, matching the search bar, instead of black.
- **Text boxes in dialogs** (`.dialog textarea`) match the other fields: rounded corners, same border and font, vertical resizing only.
- **Wide dialogs** (`.dialog-wide`, up to 980px) for the Activity Log, My requests and Manage users. Tables scroll within them on narrow screens.
- **Clipped focus rings** inside scrolling areas were fixed with inner padding.
- **Badge classes** use an `act-` / `st-` prefix. The unprefixed `login` class was picking up the login page's full-screen style.
- **Names with ñ** and other non-English characters now display correctly. The sign-in token is decoded as UTF-8 in `api.js → decodeToken`.

### 4.11 CSV import

**Import File** in Voucher Control (admins only; greyed out for normal users).

1. Choose a CSV with the columns `project_title, date, cv_no, payee, amount` (header row required, any order). A **Download a template** link is in the window.
2. The backend checks every row **without saving** and shows: rows found, rows ready, rows with problems, total amount, new projects (expandable), the date range, and a table of skipped rows with line numbers and reasons.
3. **Import N rows** saves all valid rows in one transaction and creates any new projects. One **Imported file** entry is written to the Activity Log (file name, counts, total, new projects, skipped line numbers).

| Check | Rule |
|---|---|
| Required | project title, date, CV#, payee and amount must not be empty |
| Dates | `YYYY-MM-DD`, `MM/DD/YYYY` and `Oct 30, 2026` are accepted; day-first dates (`30/10/2026`) are rejected rather than guessed |
| Amounts | `₱12,500.50`-style values are cleaned; zero, negative, text, more than 2 decimals, and over ₱99,999,999.99 are rejected |
| CV numbers | A CV# already in the system, or repeated in the file, is rejected, so importing the same file twice adds nothing |
| Projects | Titles match existing projects regardless of capitalisation; rows for an archived project are rejected |
| File | UTF-8 or Excel's plain "CSV" encoding; at most 5 MB and 10,000 rows |

Test files are in `sample_data/`: `disbursements_import_sample.csv` (100 projects, 829 valid rows, ₱159M) and `disbursements_import_errors.csv` (13 rows: 3 valid, 10 with one problem each).

### 4.12 Live updates

Changes made by anyone appear on everyone's screen within about two seconds, without reloading.

- **How it works:** every change already writes a row to the Activity Log. The backend checks that table every 1.5 seconds and pushes a small notice ("an entry was updated by Janjan") to every open browser over one long-lived connection (Server-Sent Events, `GET /live`). The browser then reloads what it's showing. The notice never contains the data itself.
- **What refreshes:** Voucher Control, the open project's entries, and any open window: Activity Log (all tabs), My requests, Manage users. Note fields you're typing in the Requests tab are kept.
- **Toast:** "Updated by Janjan." when someone else changed entries or projects. Your own actions don't trigger it.
- **Live indicator** in the top bar: a green **Live** dot when connected, yellow **Reconnecting…** otherwise. The app reconnects by itself and catches up on anything missed.
- **Privacy:** normal users don't receive account-related notices (sign-ins, resets, user changes).
- **Security:** the connection uses the normal sign-in token (sent in a header, not the URL). The backend re-checks every minute that the account is still active, and signs out a deactivated user.

### 4.13 Edit-conflict protection

Status changes were already protected (a request can't be approved twice, an entry can't be archived twice, and so on). Value edits now are too:

- **Direct edits by admins** and **edit requests** send the values the person saw for the fields they're changing. If any of those changed since the dialog was opened, the save is refused with `409`: *"Janjan changed this entry's amount after you opened it. Close it and open it again to see the latest version."* Edits to *different* fields of the same entry don't block each other.
- **Approving an edit request** is refused if the entry changed after the request was made, so an older request can't silently undo someone's newer edit. The message tells the admin to reject it and ask for a new request.
- **Simultaneous clicks** (two admins approving at the same moment, two requests for one entry, editing while archiving) are serialised with database row locks (`SELECT … FOR UPDATE`), so only the first one goes through.

---

## 5. Database changes

All changes are applied automatically when the backend starts:

- `models.Base.metadata.create_all()` creates the new tables.
- `database.ensure_schema()` adds new columns to existing tables using `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (PostgreSQL), so it's safe to run every time.
- Existing rows get safe defaults: not archived, request type `archive`, no temporary password.

### New tables

**`activity_logs`**

| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| created_at | timestamptz | indexed |
| actor | varchar(255) | username, or `system` |
| action | varchar(40) | see section 7 |
| entity_type | varchar(30) | `disbursement`, `project`, `user` |
| entity_id | integer | ID of the record (may no longer exist) |
| summary | varchar(500) | readable description |
| details | JSON | before/after values, reasons, notes, purged data |

**`deletion_requests`** (archive and edit requests)

| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| disbursement_id | integer → disbursements | `SET NULL` if the entry is purged |
| request_type | varchar(20) | `archive` or `edit` |
| project_title, cv_no, payee, amount | — | copy of the entry when requested |
| changes | JSON | edits only: `{"fields": {field: [old, new]}, "editor_name": …}` |
| reason | varchar(500) | required for archive, optional for edit |
| status | varchar(20) | `pending`, `approved`, `rejected` |
| requested_by, reviewed_by | varchar | usernames |
| review_note | varchar(500) | admin's optional note |
| created_at, reviewed_at | timestamptz | |

**`password_reset_requests`**

| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| user_id | integer → users | `SET NULL` if the account is deleted |
| username | varchar(255) | |
| message | varchar(300) | optional, from the user |
| status | varchar(20) | `pending`, `approved`, `rejected` |
| requested_at, reviewed_at | timestamptz | |
| reviewed_by, review_note | varchar | |

### New columns

| Table | Column | Default | Purpose |
|---|---|---|---|
| disbursements | is_archived | false | hidden from projects and totals |
| disbursements | archived_by, archived_at | null | who archived it, and when (starts the 30-day clock) |
| disbursements | archived_with_project | false | restored together with its project |
| projects | is_archived | false | hidden with all its entries |
| projects | archived_by, archived_at | null | who archived it, and when |
| users | must_change_password | false | set after a reset; forces a new password at sign-in |

---

## 6. API reference

"Access" means: **public** (no sign-in), **user** (any signed-in user), **admin** (superuser only). Everything here can be tried in Swagger at `/docs`.

### Authentication and accounts

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Create a normal account |
| POST | `/token` | public | Sign in; returns a JWT valid for 30 minutes |
| POST | `/users/change-password` | user* | Change own password (*also allowed while on a temporary password) |
| POST | `/auth/reset-request` | public | Forgot password: `{username, message?}` |
| GET | `/password-resets?status=pending` | admin | List reset requests |
| POST | `/password-resets/{id}/approve` | admin | Returns `{username, temporary_password}` once. Body: `{note?}` |
| POST | `/password-resets/{id}/reject` | admin | Body: `{note?}` |

### User management

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/users` | admin | All accounts with last sign-in |
| PATCH | `/users/{id}` | admin | `{name?, is_active?, is_superuser?}` |
| POST | `/users/{id}/reset-password` | admin | Returns a temporary password once |
| DELETE | `/users/{id}` | admin | Delete permanently |

### Projects

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/projects` | user | Active projects, with `total_amount` and `entry_count` |
| POST | `/projects` | user | Create a project |
| DELETE | `/projects/{id}` | admin | **Archive** the project and its entries |
| GET | `/projects/archived` | admin | Archived projects with `deletes_at` |
| POST | `/projects/{id}/restore` | admin | Restore with the entries archived alongside it |
| GET | `/projects/{title}/summary` | user | Active entries and total (404 if archived) |

### Entries (disbursements)

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/disbursements/` | user | Add an entry |
| PATCH | `/disbursements/{id}` | admin | Edit directly. Optional `original` (values seen) enables the conflict check |
| DELETE | `/disbursements/{id}?reason=` | admin | **Archive** |
| GET | `/disbursements/archived` | admin | Entries archived on their own, with `deletes_at` |
| POST | `/disbursements/import?mode=preview\|commit` | admin | CSV upload (field `file`). `preview` validates only; `commit` saves valid rows |
| POST | `/disbursements/{id}/restore` | admin | Restore an entry |

### Requests

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/disbursements/{id}/deletion-request` | user | Request archive: `{reason}` |
| POST | `/disbursements/{id}/edit-request` | user | Request edit: changed fields, plus `{reason?, editor_name?}` |
| GET | `/my-requests` | user | Own requests and outcomes |
| GET | `/deletion-requests?status=pending` | admin | All archive and edit requests |
| POST | `/deletion-requests/{id}/approve` | admin | Apply. Body: `{note?}` |
| POST | `/deletion-requests/{id}/reject` | admin | Body: `{note?}` |

### Activity Log and live updates

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/activity-logs` | admin | Query: `entity_type`, `action`, `actor`, `q`, `limit` (≤500), `offset`. Returns `{total, items}` |
| GET | `/live` | user | Server-Sent Events stream of change notices (`hello`, messages, `resync`, `bye`) |

### Common error responses

| Code | Meaning |
|---|---|
| 401 | Not signed in, token expired, or account deactivated (the app signs out) |
| 403 | Admin only; can't review own request; or still on a temporary password |
| 404 | Record not found (or project archived, for summaries) |
| 409 | The entry already has a pending request, or it changed since you opened it / since the request was made |
| 400 | Business rule, e.g. "already archived", "last active admin", "nothing was changed" |

---

## 7. Activity Log action reference

| Action | Label in the app | Recorded when | Record type |
|---|---|---|---|
| `create` | Added entry | An entry is added | disbursement |
| `update` | Edited entry | An admin edits an entry (old → new) | disbursement |
| `archive` | Archived | An admin archives an entry | disbursement |
| `restore` | Restored | An admin restores an entry | disbursement |
| `archive_requested` | Archive requested | A user asks to archive | disbursement |
| `archive_approved` / `archive_rejected` | Archive approved / rejected | An admin decides | disbursement |
| `edit_requested` | Edit requested | A user asks to edit | disbursement |
| `edit_approved` / `edit_rejected` | Edit approved / rejected | An admin decides | disbursement |
| `import` | Imported file | An admin imports a CSV | disbursement |
| `project_create` | Created project | A project is created (directly, or with its first entry) | project |
| `project_archive` | Archived project | An admin archives a project | project |
| `project_restore` | Restored project | An admin restores a project | project |
| `project_delete` | Deleted project | Earlier empty-project deletes (no longer used) | project |
| `purge` | Deleted permanently | The 30-day purge removes data (actor `system`) | project / disbursement |
| `register` | Registered | An account is created | user |
| `login` / `login_failed` | Signed in / Failed sign-in | Sign-in attempts | user |
| `password_change` | Changed password | Own password changed, or a temporary one replaced | user |
| `reset_requested` | Reset requested | Forgot password submitted | user |
| `reset_approved` / `reset_rejected` | Reset approved / rejected | An admin decides | user |
| `admin_reset` | Password reset by admin | Reset from Manage users | user |
| `user_update` | Updated account | Rename, role or status change | user |
| `user_delete` | Deleted account | Account deleted | user |
| `promote_admin` | Made admin | Default admin created or promoted by `init_db` | user |

---

## 8. File-by-file changes

### Backend (`Project/Backend`)

| File | Status | What changed |
|---|---|---|
| `auth.py` | changed | Main app. New routers registered; startup database upgrade; hourly purge (`lifespan`); token carries name, role and temporary-password flag; every route logs its action; edit and archive are admin-only; archive replaces delete; project archive route; archived project titles are blocked |
| `activity.py` | **new** | Logging helpers; archive, restore and purge logic; Activity Log, Archived and Restore routes; `RETENTION_DAYS` |
| `deletion_requests.py` | **new** | Archive and edit requests, My requests, approve/reject with notes |
| `password_resets.py` | **new** | Forgot-password flow and temporary password generator |
| `users_admin.py` | **new** | Manage users routes with self and last-admin protection |
| `imports.py` | **new** | CSV import with preview and per-row validation |
| `live.py` | **new** | Live updates: Activity Log watcher and `/live` stream |
| `Dockerfile`, `.dockerignore`, `requirements.txt` | **new** | Image for the shared backend (Linux-friendly dependency list) |
| `docker-compose.yml` | changed | New `api` service next to `db` |
| `models.py` | changed | Archive columns; `archived_with_project`; `must_change_password`; new `ActivityLog`, `DeletionRequest`, `PasswordResetRequest`; totals skip archived entries |
| `database.py` | changed | `ensure_schema()` adds new columns; `init_db()` promotes an existing `admin` and logs it |
| `security.py` | changed | `get_current_superuser`; `get_current_user` blocks temporary passwords (`get_current_user_allow_temporary` allows them); deactivated accounts get `401` |
| `crud.py` | changed | Archived projects and entries excluded from lists and summaries; hard-delete removed |
| `schemas.py` | changed | `ProjectResponse.entry_count` |

### Frontend (`Project/Frontend/src`)

| File | Status | What changed |
|---|---|---|
| `api/api.js` | changed | Methods for requests, archive/restore, Activity Log, password resets and users; `me()` reads role and temporary-password flag; UTF-8 token decoding |
| `App.jsx` | changed | Passes the reset handler to Login; shows **Set a new password** when required |
| `App.css` | changed | Yellow focus ring, textarea styling, wide dialogs, tabs, badges, filters, countdowns, temporary-password box, user panel |
| `components/Login.jsx` | changed | **Forgot password?** mode and confirmation |
| `components/ForcePasswordChange.jsx` | **new** | Forced new-password screen |
| `components/Dashboard.jsx` | changed | Activity Log / My requests buttons; Manage users; request-based editing for normal users; project archiving |
| `components/SummaryOfExpenses.jsx` | changed | Edit / Archive for admins, Request edit / Request archive for users; reason box |
| `components/EntryDialog.jsx` | changed | **Request changes** mode with an optional reason |
| `components/ProjectsTable.jsx` | changed | Admin **Archive** button and confirmation |
| `components/ActivityLog.jsx` | **new** | Activity, Archived, Requests and Password resets tabs |
| `components/DeletionRequests.jsx` | **new** | Requests tab; shared request display pieces |
| `components/MyRequests.jsx` | **new** | Normal users' request history |
| `components/PasswordResets.jsx` | **new** | Admin reset approvals with one-time password display |
| `components/UsersDialog.jsx` | **new** | Manage users window |
| `components/AdminMenu.jsx` | changed | **Manage users** menu item for admins |
| `components/ImportDialog.jsx` | **new** | Import window with preview |
| `api/live.js` | **new** | Live-updates connection with automatic reconnect |
| `Frontend/.env.example` | **new** | Points the app at the shared backend (copy to `.env.local`) |

---

## 9. Settings you can change

| Setting | File | Default | Notes |
|---|---|---|---|
| `RETENTION_DAYS` | `Backend/activity.py` | 30 | Days before archived items are deleted permanently. Set to `0` temporarily to test the purge |
| `PURGE_EVERY_SECONDS` | `Backend/auth.py` | 3600 | How often the purge runs |
| `LIVE_CHECK_SECONDS` | `Backend/live.py` | 1.5 | How often the backend looks for new changes to push |
| `VITE_API_URL` | `Frontend/.env.local` | shared backend | Which backend the app talks to |
| Token lifetime | `Backend/auth.py` (`/token` route) | 30 minutes | Users are signed out after this |
| Temporary password length | `Backend/password_resets.py` (`make_temporary_password`) | 10 | |
| Activity page size | `Frontend/src/components/ActivityLog.jsx` (`PAGE`) | 50 | |

---

## 10. Testing checklist

Restart `uvicorn auth:app --reload`, refresh the app, and sign in again so the new token is issued.

**Roles**

- [ ] As a normal user, the menu shows your name; as `admin`, it shows **Admin**.
- [ ] As a normal user in Swagger, `DELETE /disbursements/{id}` returns `403`.

**Requests**

- [ ] Normal user: **Request edit** → change the amount → Send. The table still shows the old amount.
- [ ] Admin: Activity Log → Requests shows old → new. Add a note and approve. The table shows the new amount.
- [ ] Normal user: **My requests** shows *Approved* and the note.
- [ ] Repeat with **Request archive** and **Reject**.

**Archiving**

- [ ] Admin: archive an entry. The project total drops; the entry appears under Archived → Entries with "29 days left"; Restore brings it back.
- [ ] Admin: archive a project with entries. It disappears from Voucher Control; restore it and the entries and total return.
- [ ] Creating a project with an archived project's title shows the "archived" message.

**Purge** (optional)

- [ ] Set `RETENTION_DAYS = 0`, restart, archive something, restart again. It's gone, and Activity shows *Deleted permanently* with its details. Set it back to `30`.

**Passwords**

- [ ] Sign out → **Forgot password?** → username → Send.
- [ ] Admin: Activity Log → Password resets → Approve. Copy the temporary password.
- [ ] Sign in with it → **Set a new password** → dashboard.

**Users**

- [ ] Admin: Manage users → a user → Make admin, Deactivate (they can't sign in), Reactivate.
- [ ] Trying to deactivate yourself, or the only admin, is refused.

**Import**

- [ ] Admin: Import File → sample file → 829 ready, 100 new projects → Import. Choosing it again rejects all rows as already existing.
- [ ] The errors file shows 3 ready and 10 skipped, each with a reason.

**Live updates and conflicts** (two browsers, two accounts)

- [ ] Both show the green **Live** dot. Adding an entry in one appears in the other within ~2 seconds, with "Updated by …".
- [ ] Both admins open Edit on the same entry and change the amount. The second save is refused with the "changed after you opened it" message.
- [ ] A user requests an edit; an admin edits the same field directly; approving the request is refused.

**Activity Log**

- [ ] Every action above appears. **Record type** filters Entries, Projects and Accounts.

---

## 11. Known issues and follow-ups

These were found during the work but are not fixed yet:

1. **Demo mode is incomplete.** A teammate fixed `src/api/mockAPI.js` (commit `96f9182`), but it doesn't include the newer features (requests, Activity Log, users, import), so those screens won't work with `VITE_DEMO=true`. Live updates are switched off in demo mode.
2. **Lint warnings that predate this update:** `Dashboard.jsx` (setState inside an effect, two places), `AdminMenu.jsx` (unused `initial` prop) and `App.jsx` (re-thrown error without `cause`). The app runs normally.
3. **The root `requirements.txt` is saved as UTF-16** (from PowerShell's `>`), and includes Windows-only packages. The shared backend uses `Backend/requirements.txt` instead. To fix the root one, regenerate it as UTF-8:
   `pip freeze | Out-File -Encoding utf8 requirements.txt`
4. **Secrets are hard-coded:** `SECRET_KEY` in `security.py` and the database password in `database.py`/`docker-compose.yml`. Move them to environment variables before deploying.
5. **CORS allows every origin** (`allow_origins=["*"]`). Restrict it to the real frontend address before deploying.
6. **Line endings:** files use Windows (CRLF) endings, so git may show whole files as changed. `git config core.autocrlf true` avoids this.
7. **Chatbot:** `ChatWidget.jsx` still shows a placeholder reply. Connecting it to a local Ollama model through a new FastAPI `/chat` endpoint was planned but hasn't been built yet.
8. **Single-admin lockout:** an admin can't approve their own password reset. If the only admin forgets their password, reset it from the `Backend` folder with:
   ```powershell
   python -c "import database, models, security; db = database.SessionLocal(); u = db.query(models.User).filter_by(username='admin').first(); u.hashed_password = security.get_password_hash('admin123'); db.commit()"
   ```
