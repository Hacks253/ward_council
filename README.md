# Ward Council

First pass of the Ward Council app (Phase 1 of `docs/ward-council-prd.md`): auth, roster,
agenda, live meeting view, close-and-snapshot, archive, and server-enforced confidentiality.
The UI is a direct port of the reference mockup (`docs/ward-council-mobile.html`).

## Run it

```sh
docker compose up --build
```

Open http://localhost:3000 and sign in. Three users are seeded on first start
(password `ward-council`, or whatever `SEED_PASSWORD` is set to in `docker-compose.yml`):

| Username  | Role      | Sees sensitive items | Can edit                        |
| --------- | --------- | -------------------- | ------------------------------- |
| `josh`    | bishopric | yes                  | everything, incl. people        |
| `bishop`  | bishopric | yes                  | everything, incl. people        |
| `council` | council   | no (redacted)        | capture only (attendance/notes) |

## Roles and sections

Two access levels plus per-person section ownership, managed in the
**People and access** panel at the bottom of the Edit view (full-access users only):

- **Full access** (`bishopric` role — bishop, counselors, exec sec, ward clerk):
  edits everything, sees held/sensitive items, closes meetings, manages people.
- **Council** with **sections**: a section is a name like `Primary` or
  `Sunday School` that matches an agenda item title or a point heading
  (case-insensitive). Section owners get a trimmed Edit tab showing only their
  sections, where they can update their point details, add/remove their own
  points, and (if they own a whole block by title) its description too. Name
  matching means ownership survives the weekly roll-forward automatically.
- **Council** with no sections: meeting capture only — attendance, notes, outcomes.

The boundary is enforced server-side: a council save is merged against the
stored document and anything outside the user's sections (other points, block
titles/durations/order, roster, sensitive flags) is ignored. Section owners can
never see or edit sensitive points and cannot mark points sensitive.

Users can also be added from the CLI:

```sh
docker compose exec ward-council node server/adduser.js katrina "Katrina M." council somepassword "Primary"
```

## Architecture

- **One container**: Node 24 + Express serving a JSON API and a static frontend.
  No build step, no framework — the frontend is the mockup with its storage layer
  swapped for the API.
- **SQLite** via Node's built-in `node:sqlite`, stored on the `ward_council_data`
  volume. Right-sized for ~14 users; no separate DB container.
- **Local login**: username/password (bcrypt), signed cookie session. The PRD's
  magic-link auth can replace this later without touching the meeting model.
- **Living copy → snapshot**: the draft meeting is a JSON document saved as you
  type. Closing writes an immutable row to `snapshots` (insert-only), marks the
  meeting `closed`, and rolls forward: deferred blocks become `Carried` points in
  next Sunday's Council Items, and assignments/away/calendar/roster copy over.
  All writes to a closed meeting are rejected with 409.
- **Confidentiality is server-side**: points flagged sensitive are stripped from
  every API response for non-bishopric users (the client only ever renders a
  "held for the bishopric" marker). Council-role saves are merged on the server —
  only attendance, notes, and outcomes are taken — so a redacted client copy can
  never overwrite the real document.
- **Live state derives from the clock** (no start button), computed client-side;
  the container runs with `TZ=America/Los_Angeles`.

## API

| Route | Who | What |
| --- | --- | --- |
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | anyone | session auth |
| `GET /api/bootstrap` | signed in | user + this week's meeting (created from template if new) + archive index |
| `PUT /api/meetings/:date` | signed in | save draft — full replace for bishopric; council saves merge only capture + owned sections |
| `POST /api/meetings/:date/close` | bishopric | snapshot, close, roll forward |
| `GET /api/meetings/:date/snapshot` | signed in | frozen archive record (redacted per role) |
| `GET/POST /api/users`, `PUT/DELETE /api/users/:username` | bishopric | manage people, roles, sections, passwords |

## Not in this pass (later phases)

Email send (Resend + cron), member submissions/backlog/triage, first-class
assignments with roll-forward of due dates, second council. The data document
already carries assignments/away/calendar so those phases layer on top.
