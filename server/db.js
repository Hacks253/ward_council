import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required (postgres://...)');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 5
});

/* Schema + seed run once per process; serverless cold starts await this
   before serving their first request. Concurrent cold starts are safe:
   every insert here is ON CONFLICT DO NOTHING. */
let readyP = null;
export function ready() {
  readyP ??= init();
  return readyP;
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('bishopric','council')),
      sections      JSONB NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS meetings (
      date      TEXT PRIMARY KEY,
      status    TEXT NOT NULL CHECK (status IN ('draft','closed')),
      payload   JSONB NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      date       TEXT PRIMARY KEY,
      payload    JSONB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS absences (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      starts_on TEXT NOT NULL,
      ends_on   TEXT NOT NULL
    );
  `);
  await seedUsersIfEmpty();
}

/* ---- users ---- */

function mapUser(row) {
  if (!row) return null;
  return { ...row, sections: Array.isArray(row.sections) ? row.sections.map(String) : [] };
}

export async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return mapUser(rows[0]);
}

export async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return mapUser(rows[0]);
}

export async function listUsers() {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY username');
  return rows.map(mapUser);
}

export async function createUser(username, displayName, role, password, sections = []) {
  const hash = bcrypt.hashSync(password, 10);
  await pool.query(
    `INSERT INTO users (username, display_name, password_hash, role, sections)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING`,
    [username, displayName, hash, role, JSON.stringify(sections)]
  );
}

export async function updateUser(username, patch) {
  const sets = [], vals = [];
  let i = 1;
  if (patch.displayName !== undefined) { sets.push(`display_name = $${i++}`); vals.push(patch.displayName); }
  if (patch.role !== undefined) { sets.push(`role = $${i++}`); vals.push(patch.role); }
  if (patch.sections !== undefined) { sets.push(`sections = $${i++}`); vals.push(JSON.stringify(patch.sections)); }
  if (patch.password !== undefined) { sets.push(`password_hash = $${i++}`); vals.push(bcrypt.hashSync(patch.password, 10)); }
  if (!sets.length) return;
  vals.push(username);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE username = $${i}`, vals);
}

export async function deleteUser(username) {
  await pool.query('DELETE FROM users WHERE username = $1', [username]);
}

async function seedUsersIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const pw = process.env.SEED_PASSWORD || 'ward-council';
  await createUser('josh', 'Josh', 'bishopric', pw);
  await createUser('bishop', 'Bp. Bradshaw', 'bishopric', pw);
  await createUser('council', 'Council member', 'council', pw);
  console.log(`Seeded users: josh, bishop (full access) and council. Password: "${pw}"`);
}

/* ---- meetings ---- */

export async function getMeeting(date) {
  const { rows } = await pool.query('SELECT * FROM meetings WHERE date = $1', [date]);
  if (!rows[0]) return null;
  return { date: rows[0].date, status: rows[0].status, closedAt: rows[0].closed_at, payload: rows[0].payload };
}

export async function insertMeeting(date, status, payload) {
  await pool.query(
    'INSERT INTO meetings (date, status, payload) VALUES ($1, $2, $3) ON CONFLICT (date) DO NOTHING',
    [date, status, JSON.stringify(payload)]
  );
}

export async function updateMeetingPayload(date, payload) {
  await pool.query(
    "UPDATE meetings SET payload = $1 WHERE date = $2 AND status = 'draft'",
    [JSON.stringify(payload), date]
  );
}

export async function closeMeetingRow(date, payload, closedAt) {
  await pool.query(
    "UPDATE meetings SET status = 'closed', payload = $1, closed_at = $2 WHERE date = $3",
    [JSON.stringify(payload), closedAt, date]
  );
}

export async function listIndex() {
  const { rows } = await pool.query('SELECT date, status FROM meetings ORDER BY date');
  return rows;
}

/* ---- absences (council-level; agenda "Away" sections derive from these) ---- */

export async function listAbsences() {
  const { rows } = await pool.query('SELECT * FROM absences ORDER BY starts_on, ends_on, name');
  return rows;
}

export async function insertAbsence(name, startsOn, endsOn) {
  await pool.query('INSERT INTO absences (name, starts_on, ends_on) VALUES ($1, $2, $3)', [name, startsOn, endsOn]);
}

export async function deleteAbsence(id) {
  await pool.query('DELETE FROM absences WHERE id = $1', [id]);
}

/* ---- snapshots (insert-only; never updated) ---- */

export async function getSnapshot(date) {
  const { rows } = await pool.query('SELECT payload FROM snapshots WHERE date = $1', [date]);
  return rows[0] ? rows[0].payload : null;
}

export async function insertSnapshot(date, payload, createdAt) {
  await pool.query(
    'INSERT INTO snapshots (date, payload, created_at) VALUES ($1, $2, $3) ON CONFLICT (date) DO NOTHING',
    [date, JSON.stringify(payload), createdAt]
  );
}
