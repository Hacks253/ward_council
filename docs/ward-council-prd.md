# Ward Council — Product Requirements

**Owner:** Josh Cridlebaugh
**Status:** Ready to build
**Last updated:** 30 July 2026

---

## 1. Problem

Orting Ward council meets Sundays 7:30–8:30 a.m. The agenda lives in a Word document that gets copy-pasted forward each week. This causes:

- **Retyping.** Roster, presiding, calendar, and standing sections are re-entered weekly. Names drift ("Greg"/"Gregg", "Ryan"/"Ryan Galusha") because there is no members list.
- **No follow-up loop.** Assignments are captured in prose. Nothing carries forward automatically, so items get lost or re-raised.
- **No outcomes.** The document is titled "Minutes" but records almost nothing about what was decided. Training notes end up handwritten in the page margin.
- **No history.** There is no way to answer "what did we decide about this in May?"
- **Time drift.** No time budget, so the hour is consumed by whatever comes first.

## 2. Goals

1. Eliminate weekly retyping — the recurring parts are data, not text.
2. Every agenda item leaves the meeting with an outcome and, where relevant, an owner and due date.
3. Deferred items and open assignments carry forward automatically.
4. Every past meeting is retrievable as an immutable record.
5. The agenda emails itself before the meeting.

**Non-goals for v1:** mobile native apps, integration with Church systems (LCR, Member Tools), rich text, file attachments, real-time multi-user editing, calendar sync.

## 3. Users

| Role | Needs |
| --- | --- |
| Bishop | Sees the week at a glance; sole access to confidential items; decides what reaches council |
| Agenda owner (Josh) | Builds the agenda, manages roster, triages submissions |
| Note taker | Captures outcomes fast during the meeting on a phone |
| Council member | Submits items during the week; reads the agenda before Sunday; sees own assignments |

Roughly 10–14 people. Low volume. No scale requirements.

## 4. Grounding: General Handbook 4.4

The agenda structure is derived from section 4.4, *Principles of Effective Councils*. These map to concrete requirements:

- **4.4.1 Purposes** — councils exist to counsel about people, with particular care for those with pressing needs. Administrative business such as calendar planning generally does not need council discussion and can be handled before and after. → *Calendar and absences are reference data in a sidebar, not agenda items. Purpose tags do not include "Inform."*
- **4.4.2 Preparation** — leaders share matters in advance and seek input from members on what to discuss. → *Open submission with a pre-meeting cutoff; agenda emailed before the meeting.*
- **4.4.5 Action and accountability** — most work happens before and after the meeting; members report on assignments; individuals should not be overburdened. → *Assignments are first-class records with owner and due date; show an open-assignment count per person during triage.*
- **4.4.6 Confidentiality** — use discretion with personal information, generally seek the member's permission, and some matters are too sensitive for the full council. → *Per-item `is_sensitive` flag; detail visible only to the bishopric, placeholder text everywhere else, including in email.*

## 5. Core model: living copy → snapshot

This is the central design decision.

- A meeting in `draft` status is a **living copy**. Notes save as typed. Attendance, outcomes, and agenda content are all mutable.
- Closing the meeting writes an **immutable snapshot** — a complete denormalized copy of the meeting as it existed at that moment, including the roster, the agenda text, and all captured outcomes.
- Snapshots are never edited. Editing routes are rejected for closed meetings.

**Rationale:** minutes are a record of what was true at a moment. If a council member is released in September, July's minutes must still show they attended. If a standing section is renamed, last spring's record must not retroactively change. Normalized joins would silently rewrite history; a frozen copy cannot.

Closing also performs **roll-forward**: create next Sunday's draft from the template, prepend any block marked `Deferred` to Council Items with a `Carried <date>` tag, and carry over open assignments, away dates, calendar, and roster.

## 6. Functional requirements

### 6.1 Meeting view (default)

- Header shows unit, meeting name, date, and 7:30–8:30 a.m.
- **No start button.** Live state derives from the wall clock. Status chip reads:
  - `Upcoming` — before 7:30 on meeting day, or any other day
  - `Live` — during the hour; pulsing dot
  - `Ended` — after 8:30 on meeting day, still open
  - `Archived` — meeting is closed
- While live: a progress bar across the hour, the current block name, and minutes remaining (turning amber and reading "N min over" past the block's allotment).
- Agenda renders as a vertical card stack on a timeline spine. Past blocks marked done, current block highlighted, spine fills proportionally.
- Attendance is tap-to-toggle pills with a present/total count.
- Each block has a collapsible Notes area: a textarea plus outcome buttons — **Decided / Assigned / Deferred / Referred**. Outcome is single-select and clearable.
- Collapsible sections at the bottom: Open assignments, Away (next 30 days), Calendar.
- `Close meeting and archive` button.

### 6.2 Edit view

Everything is editable; nothing is hardcoded.

- Agenda blocks: title, duration in minutes, purpose tag (`Counsel` / `Decide` / `Coordinate` / none), description. Add, delete, reorder.
- Points within a block: heading, detail, tag. A point **with** a heading renders as a titled sub-section; **without** one it renders as a plain bullet. One field controls both treatments.
- Per-block confidential placeholder text.
- Roster: add and remove names.
- List editors for assignments (what/who/when), away (who/when), calendar (what/when).
- **Minute budget** indicator: sums block durations against the 60-minute window. Green at exactly 60, amber otherwise, showing "N over" or "N to fill." Updates live.
- Edit is disabled for closed meetings; show an archived notice instead.

### 6.3 Archive view

- Reverse-chronological list of closed meetings.
- Opening one renders the meeting read-only: notes appear as minutes prose, outcomes as stamps, attendance locked, no editors, banner explaining the record is frozen.
- Empty state when nothing has been closed yet.

### 6.4 Submission and triage

- Any council member can add an item to a backlog at any time.
- Cutoff Wednesday 9 p.m.; later submissions default to the following week.
- Agenda owner triages: assign to a meeting, set order, duration, purpose tag, and owner.
- Triage screen shows each person's count of open assignments (per 4.4.5).

### 6.5 Email

- Sends Friday morning (configurable) via Resend.
- Content mirrors the agenda: frame, blocks with owners and durations, open assignments, calendar.
- Sensitive items render as a placeholder line, never the detail.
- BCC the roster so it does not become a reply-all thread.
- Send is idempotent — record `sent_at`; never double-send for one meeting.

### 6.6 Confidentiality

- `is_sensitive` boolean on agenda items and points.
- Enforced at the database layer via row-level security, not only in the UI.
- Non-bishopric users and all email recipients see placeholder text.

## 7. Data model

```sql
councils        id, unit_name, name, meets_dow, start_time, duration_min
members         id, email, display_name, calling, role, active
                -- role: 'bishopric' | 'council'
meetings        id, council_id, meets_on, status, closed_at, sent_at
                -- status: 'draft' | 'closed'
blocks          id, meeting_id, title, duration_min, purpose_tag,
                lead_text, held_text, position, notes, outcome
                -- purpose_tag: 'counsel' | 'decide' | 'coordinate' | null
                -- outcome: 'decided' | 'assigned' | 'deferred' | 'referred' | null
points          id, block_id, heading, detail, tag, is_carried,
                is_sensitive, position
backlog_items   id, council_id, title, detail, submitted_by,
                submitted_at, target_meeting_id, is_sensitive
assignments     id, council_id, title, owner_id, due_on,
                status, origin_block_id
                -- status: 'open' | 'done'
absences        id, member_id, starts_on, ends_on
calendar_items  id, council_id, title, occurs_on
snapshots       meeting_id, payload jsonb, created_at
                -- complete frozen copy; the archive reads only this
```

Notes:
- `snapshots.payload` is the full denormalized meeting. Archive views never join to live tables.
- Standing sections live as template rows on the council and are copied into each new meeting's blocks.
- Multi-council is supported from day one via `council_id` — ward council ships first, bishopric follows without a migration.

## 8. Stack

- **Next.js (App Router) on Vercel**
- **Supabase** — Postgres, magic-link auth, row-level security, `pg_cron` for the weekly send
- **Resend** with React Email templates
- **Tailwind**

Rationale: collapses database, auth, authorization, and scheduling into one service. RLS is the natural enforcement point for the confidentiality rule.

## 9. Auth

- Magic link only. No passwords — council members will not manage accounts.
- Roles: `bishopric` and `council`.
- RLS policies:
  - Members read meetings for councils they belong to.
  - Only `bishopric` reads rows where `is_sensitive = true`.
  - Only the agenda owner and bishopric write to blocks and points.
  - No one writes to a meeting where `status = 'closed'`.
  - No one writes to `snapshots` after insert.

## 10. Design direction

A working reference implementation exists (`ward-council-mobile.html`) — a single-file mockup with the meeting, edit, and archive views, live timing, and local persistence. **Use it as the visual and interaction spec.** Match its layout, timing behavior, and copy; do not redesign.

- Phone-first. 16px base type, 44px minimum tap targets. Council reads this on a phone at 7:30 a.m.
- Serif headings (Literata), sans body (Public Sans).
- Palette: slate blue `#2E5470` primary, sand `#9B6430` for carried and overtime, green `#3A6B4E` for outcomes and archive.
- Cards on a light neutral background, 14px radius, minimal shadow.
- Reduced-motion support; visible focus rings throughout.

A print stylesheet should render a clean one-page version for anyone who wants paper.

## 11. Phasing

| Phase | Scope | Done when |
| --- | --- | --- |
| 1 | Schema, auth, roster, agenda render, close-and-snapshot, archive | Josh types the agenda in and closes a real meeting |
| 2 | Weekly cron + Resend send, domain verification | Council receives Friday email |
| 3 | Member submission, backlog, triage screen, Wednesday cutoff | Members add items themselves |
| 4 | Assignments with owners and due dates, roll-forward, overload indicator | Deferred items appear next week unprompted |
| 5 | Bishopric council as a second council record | Second council runs with no code changes |

## 12. Acceptance criteria

- [ ] On a Tuesday, the app shows the *upcoming* Sunday, not the past one.
- [ ] Live state derives from the clock with no user action; correct at 7:29, 7:31, 8:29, and 8:31.
- [ ] Live indicators never appear on an archived meeting or in edit view.
- [ ] Notes persist without an explicit save; a refresh mid-meeting loses nothing.
- [ ] Closing a meeting writes a snapshot that a later roster change does not alter.
- [ ] A block marked Deferred appears in next Sunday's Council Items tagged `Carried`.
- [ ] A non-bishopric account cannot retrieve sensitive detail via the API, not just the UI.
- [ ] The email contains no sensitive detail.
- [ ] A second send for the same meeting is a no-op.
- [ ] Editing routes reject any closed meeting.
- [ ] All user content is escaped; a title containing `<script>` renders as text.
- [ ] Minute budget flags an agenda that does not total 60.

## 13. Open questions

1. **Confidentiality norm.** Member names currently appear in the agenda document. Emailing that to a dozen inboxes is a larger surface than paper collected after the meeting. Bishop Bradshaw decides what may be named in email versus held in-app — this must be settled before the first send.
2. **Sending domain.** Needs a domain with SPF/DKIM configured in Resend. A gmail.com sender will land in spam.
3. **Retention.** How long do snapshots persist, and who can delete one?
4. **Assignment closure.** Does an assignment close in-app by its owner, or only during the meeting?
