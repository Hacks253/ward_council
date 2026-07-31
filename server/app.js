import express from 'express';
import cookieSession from 'cookie-session';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { template, uid } from './template.js';
import { sanitizeMeeting, mergeCouncil } from './sanitize.js';
import { redactForRole } from './redact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---- dates, computed in the ward's timezone regardless of host TZ ---- */
const TZ = process.env.APP_TZ || 'America/Los_Angeles';
const pad = n => (n < 10 ? '0' : '') + n;
const dateOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (iso, n) => { const d = dateOf(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
const fmtShort = iso => dateOf(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* The Sunday this app should be showing: today if Sunday, else the next one. */
function activeSunday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
  const iso = `${get('year')}-${get('month')}-${get('day')}`;
  return dow === 0 ? iso : addDays(iso, 7 - dow);
}

const pub = u => ({ username: u.username, displayName: u.display_name, role: u.role, sections: u.sections });

async function requireAuth(req, res, next) {
  try {
    const u = req.session?.uid ? await store.getUserById(req.session.uid) : null;
    if (!u) return res.status(401).json({ error: 'Not signed in' });
    req.user = u;
    next();
  } catch (e) { next(e); }
}

function requireBishopric(req, res, next) {
  if (req.user.role !== 'bishopric') return res.status(403).json({ error: 'Bishopric only' });
  next();
}

export function createApp({ serveStatic = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  if (serveStatic) app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieSession({
    name: 'wc.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    maxAge: 30 * 24 * 3600 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: !!process.env.VERCEL
  }));

  /* Schema/seed must be in place before any request is served. */
  app.use((req, res, next) => { store.ready().then(() => next(), next); });

  /* ---- auth ---- */

  app.post('/api/login', async (req, res, next) => {
    try {
      const username = String(req.body?.username || '').toLowerCase().trim();
      const password = String(req.body?.password || '');
      const u = await store.getUserByUsername(username);
      if (!u || !bcrypt.compareSync(password, u.password_hash)) {
        return res.status(401).json({ error: 'Wrong username or password' });
      }
      req.session.uid = u.id;
      res.json({ user: pub(u) });
    } catch (e) { next(e); }
  });

  app.post('/api/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: pub(req.user) }));

  /* ---- people management (full access only) ---- */
  const USERNAME_RE = /^[a-z0-9._-]{2,30}$/;
  const cleanSections = v => (Array.isArray(v) ? v : [])
    .map(s => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 20);

  app.get('/api/users', requireAuth, requireBishopric, async (req, res, next) => {
    try { res.json({ users: (await store.listUsers()).map(pub) }); } catch (e) { next(e); }
  });

  app.post('/api/users', requireAuth, requireBishopric, async (req, res, next) => {
    try {
      const username = String(req.body?.username || '').toLowerCase().trim();
      const displayName = String(req.body?.displayName || '').trim().slice(0, 80);
      const role = req.body?.role === 'bishopric' ? 'bishopric' : 'council';
      const password = String(req.body?.password || '');
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username: 2-30 lowercase letters, numbers, . _ -' });
      if (!displayName) return res.status(400).json({ error: 'Display name is required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password needs at least 6 characters' });
      if (await store.getUserByUsername(username)) return res.status(409).json({ error: 'That username already exists' });
      await store.createUser(username, displayName, role, password, cleanSections(req.body?.sections));
      res.json({ user: pub(await store.getUserByUsername(username)) });
    } catch (e) { next(e); }
  });

  app.put('/api/users/:username', requireAuth, requireBishopric, async (req, res, next) => {
    try {
      const username = String(req.params.username).toLowerCase();
      const u = await store.getUserByUsername(username);
      if (!u) return res.status(404).json({ error: 'No such user' });
      const patch = {};
      if (typeof req.body?.displayName === 'string' && req.body.displayName.trim()) {
        patch.displayName = req.body.displayName.trim().slice(0, 80);
      }
      if (req.body?.role === 'bishopric' || req.body?.role === 'council') {
        if (u.id === req.user.id && req.body.role !== req.user.role) {
          return res.status(400).json({ error: 'You cannot change your own access level' });
        }
        patch.role = req.body.role;
      }
      if (Array.isArray(req.body?.sections)) patch.sections = cleanSections(req.body.sections);
      if (typeof req.body?.password === 'string' && req.body.password) {
        if (req.body.password.length < 6) return res.status(400).json({ error: 'Password needs at least 6 characters' });
        patch.password = req.body.password;
      }
      await store.updateUser(username, patch);
      res.json({ user: pub(await store.getUserByUsername(username)) });
    } catch (e) { next(e); }
  });

  app.delete('/api/users/:username', requireAuth, requireBishopric, async (req, res, next) => {
    try {
      const username = String(req.params.username).toLowerCase();
      const u = await store.getUserByUsername(username);
      if (!u) return res.status(404).json({ error: 'No such user' });
      if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot remove yourself' });
      await store.deleteUser(username);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ---- meetings ---- */

  /* Current user + this week's meeting (created from template if new) + archive index. */
  app.get('/api/bootstrap', requireAuth, async (req, res, next) => {
    try {
      const today = activeSunday();
      let row = await store.getMeeting(today);
      if (!row) {
        await store.insertMeeting(today, 'draft', template(today));
        row = await store.getMeeting(today);
      }
      const meeting = row.status === 'closed' ? (await store.getSnapshot(today) || row.payload) : row.payload;
      res.json({
        user: pub(req.user),
        today,
        meeting: redactForRole(meeting, req.user.role),
        index: await store.listIndex()
      });
    } catch (e) { next(e); }
  });

  /* Save the draft. Bishopric replaces the document; council writes merge only
     capture (attendance/notes/outcomes) plus their owned sections. */
  app.put('/api/meetings/:date', requireAuth, async (req, res, next) => {
    try {
      const { date } = req.params;
      if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Bad date' });
      const row = await store.getMeeting(date);
      if (!row) return res.status(404).json({ error: 'No such meeting' });
      if (row.status === 'closed') return res.status(409).json({ error: 'This meeting is archived and cannot be edited' });

      const nextDoc = req.user.role === 'bishopric'
        ? sanitizeMeeting(req.body, date)
        : mergeCouncil(row.payload, req.body, req.user.sections);
      await store.updateMeetingPayload(date, nextDoc);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* Close: freeze an immutable snapshot, then roll forward to next Sunday. */
  app.post('/api/meetings/:date/close', requireAuth, requireBishopric, async (req, res, next) => {
    try {
      const { date } = req.params;
      if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Bad date' });
      const row = await store.getMeeting(date);
      if (!row) return res.status(404).json({ error: 'No such meeting' });
      if (row.status === 'closed') return res.status(409).json({ error: 'Already archived' });

      const closedAt = new Date().toISOString();
      const snap = structuredClone(row.payload);
      snap.status = 'closed';
      snap.closedAt = closedAt;
      await store.insertSnapshot(date, snap, closedAt);
      await store.closeMeetingRow(date, snap, closedAt);

      const nextDate = addDays(date, 7);
      const carried = snap.blocks
        .filter(b => b.outcome === 'Deferred')
        .map(b => ({
          id: uid(), h: b.title, p: 'Deferred last week - needs a decision',
          tag: 'Carried ' + fmtShort(date), carry: true, sens: false
        }));

      const nextRow = await store.getMeeting(nextDate);
      if (!nextRow) {
        const nm = template(nextDate);
        nm.roster = snap.roster.slice();
        nm.assignments = structuredClone(snap.assignments);
        nm.away = structuredClone(snap.away);
        nm.calendar = structuredClone(snap.calendar);
        addCarried(nm, carried);
        await store.insertMeeting(nextDate, 'draft', nm);
      } else if (nextRow.status === 'draft' && carried.length) {
        addCarried(nextRow.payload, carried);
        await store.updateMeetingPayload(nextDate, nextRow.payload);
      }

      res.json({
        meeting: redactForRole(snap, req.user.role),
        index: await store.listIndex()
      });
    } catch (e) { next(e); }
  });

  /* Archived record — always read from the snapshot, never the live tables. */
  app.get('/api/meetings/:date/snapshot', requireAuth, async (req, res, next) => {
    try {
      const { date } = req.params;
      if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Bad date' });
      const snap = await store.getSnapshot(date);
      if (!snap) return res.status(404).json({ error: 'No archived record for that date' });
      res.json({ meeting: redactForRole(snap, req.user.role) });
    } catch (e) { next(e); }
  });

  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

function addCarried(m, carried) {
  if (!carried.length) return;
  const target = m.blocks.find(b => /council items/i.test(b.title)) || m.blocks[0];
  if (target) target.points = carried.concat(target.points || []);
}
