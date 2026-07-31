/* Confidentiality enforcement (PRD 6.6): sensitive detail leaves the server
   only for bishopric-role users. Everyone else gets a stripped marker per
   sensitive point — the heading, detail, and tag are removed entirely. */
export function redactForRole(meeting, role) {
  if (role === 'bishopric') return meeting;
  const m = structuredClone(meeting);
  for (const b of m.blocks || []) {
    b.points = (b.points || []).map(p =>
      p && p.sens ? { id: p.id, redacted: true } : p
    );
  }
  return m;
}
