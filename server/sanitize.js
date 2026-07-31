import { uid, OUTCOMES, BLOCK_TAGS } from './template.js';

const ID_RE = /^[a-z0-9]{1,16}$/i;

const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = v => (typeof v === 'string' && ID_RE.test(v) ? v : uid());
const clampInt = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
};
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

function sanitizePoint(p) {
  p = p && typeof p === 'object' ? p : {};
  return {
    id: id(p.id),
    h: str(p.h, 300),
    p: str(p.p, 2000),
    tag: str(p.tag, 60),
    carry: !!p.carry,
    sens: !!p.sens
  };
}

function sanitizeBlock(b) {
  b = b && typeof b === 'object' ? b : {};
  return {
    id: id(b.id),
    title: str(b.title, 200),
    dur: clampInt(b.dur, 0, 60, 5),
    tag: BLOCK_TAGS.includes(b.tag) ? b.tag : '',
    lead: str(b.lead, 1000),
    points: arr(b.points, 50).map(sanitizePoint),
    held: str(b.held, 500),
    notes: str(b.notes, 8000),
    outcome: OUTCOMES.includes(b.outcome) ? b.outcome : '',
    ph: str(b.ph, 200)
  };
}

/* Full rebuild of a meeting document from untrusted input (bishopric writes). */
export function sanitizeMeeting(input, date) {
  const m = input && typeof input === 'object' ? input : {};
  const roster = arr(m.roster, 40).map(n => str(n, 80).trim()).filter(Boolean);
  const attendance = {};
  if (m.attendance && typeof m.attendance === 'object') {
    for (const name of roster) {
      if (name in m.attendance) attendance[name] = !!m.attendance[name];
    }
  }
  const row3 = r => ({ id: id(r && r.id), t: str(r && r.t, 300), o: str(r && r.o, 120), d: str(r && r.d, 120) });
  const row2 = r => ({ id: id(r && r.id), n: str(r && r.n, 300), w: str(r && r.w, 120) });
  return {
    v: 3,
    date,
    status: 'draft',
    roster,
    attendance,
    blocks: arr(m.blocks, 30).map(sanitizeBlock),
    assignments: arr(m.assignments, 100).map(row3),
    away: arr(m.away, 100).map(row2),
    calendar: arr(m.calendar, 100).map(row2)
  };
}

/* Section ownership matches by name: a user's section list is compared,
   case-insensitively, against block titles and point headings. Names are
   stable week to week ("Primary", "Sunday School"), so ownership survives
   the weekly template without reassignment. */
const normName = s => String(s || '').trim().toLowerCase();
const ownsName = (name, sections) => {
  const n = normName(name);
  return !!n && sections.some(s => normName(s) === n);
};

/* Rebuild one block's point list from a section owner's save.
   - Points they own (whole block, or heading matches a section): sanitized
     incoming version wins; point owners cannot rename their heading (that
     would move the point out of their section) and can never flip `sens`.
   - Points they do not own: the stored version is kept — edits and
     deletions are ignored, re-inserted at their original position.
   - Sensitive points always come from the stored copy.
   - New points are accepted only inside an owned block or with an owned
     heading, and are never sensitive. */
function mergePoints(storedPts, incoming, sections, ownsBlock) {
  const inc = arr(incoming, 50).filter(x => x && typeof x === 'object');
  const byId = new Map(storedPts.map(p => [p.id, p]));
  const used = new Set();
  const result = [];

  for (const raw of inc) {
    const sp = typeof raw.id === 'string' ? byId.get(raw.id) : undefined;
    if (sp) {
      if (sp.sens || used.has(sp.id)) continue;
      used.add(sp.id);
      if (ownsBlock || ownsName(sp.h, sections)) {
        const s = sanitizePoint(raw);
        s.id = sp.id;
        s.sens = sp.sens;
        if (!ownsBlock) s.h = sp.h;
        result.push(s);
      } else {
        result.push(structuredClone(sp));
      }
    } else {
      const s = sanitizePoint(raw);
      s.sens = false;
      if (ownsBlock || ownsName(s.h, sections)) result.push(s);
    }
  }

  storedPts.forEach((sp, i) => {
    if (used.has(sp.id)) return;
    const deletable = !sp.sens && (ownsBlock || ownsName(sp.h, sections));
    if (deletable) return;
    result.splice(Math.min(i, result.length), 0, structuredClone(sp));
  });
  return result;
}

/* Council-role writes. Everyone signed in may capture the meeting —
   attendance, notes, outcomes. Users with assigned sections may also edit
   agenda content inside those sections. Block structure (titles, durations,
   order, add/delete) and everything else always comes from the stored copy,
   so a redacted or tampered client document can never overwrite the real one. */
export function mergeCouncil(stored, input, sections) {
  sections = Array.isArray(sections) ? sections : [];
  const out = structuredClone(stored);
  const m = input && typeof input === 'object' ? input : {};

  if (m.attendance && typeof m.attendance === 'object') {
    for (const name of out.roster) {
      if (name in m.attendance) out.attendance[name] = !!m.attendance[name];
    }
  }

  const incBlocks = arr(m.blocks, 100);
  for (const b of out.blocks) {
    const ib = incBlocks.find(x => x && typeof x === 'object' && x.id === b.id);
    if (!ib) continue;
    if (typeof ib.notes === 'string') b.notes = ib.notes.slice(0, 8000);
    if (ib.outcome === '' || OUTCOMES.includes(ib.outcome)) b.outcome = ib.outcome;

    if (!sections.length) continue;
    const ownsBlock = ownsName(b.title, sections);
    if (ownsBlock) {
      b.lead = str(ib.lead, 1000);
      b.held = str(ib.held, 500);
    }
    b.points = mergePoints(b.points, ib.points, sections, ownsBlock);
  }
  return out;
}
