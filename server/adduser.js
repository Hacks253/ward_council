import { ready, pool, createUser, getUserByUsername } from './db.js';

const [username, displayName, role, password, sectionsArg] = process.argv.slice(2);

if (!username || !displayName || !role || !password || !['bishopric', 'council'].includes(role)) {
  console.error('Usage: node server/adduser.js <username> "<Display Name>" <bishopric|council> <password> ["Section, Section"]');
  process.exit(1);
}

await ready();

if (await getUserByUsername(username.toLowerCase())) {
  console.error(`User "${username}" already exists.`);
  await pool.end();
  process.exit(1);
}

const sections = (sectionsArg || '').split(',').map(s => s.trim()).filter(Boolean);
await createUser(username.toLowerCase(), displayName, role, password, sections);
console.log(`Created ${role} user "${username.toLowerCase()}" (${displayName})${sections.length ? ' owning: ' + sections.join(', ') : ''}.`);
await pool.end();
