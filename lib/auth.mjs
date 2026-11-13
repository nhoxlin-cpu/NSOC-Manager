import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const roles = ['admin', 'inspector', 'viewer'];
export const digest = value => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    throw new Error('Mật khẩu phải có từ 8 đến 128 ký tự.');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, expected] = stored.split(':');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
export const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role });
export function issueSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token), userId, csrf, Date.now() + 8 * 3600_000);
  return { token, csrf };
}
export function sessionUser(db, cookie = '') {
  const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('wa_session='))?.slice(11);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`SELECT u.*, s.csrf, s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires>? AND u.active=1`).get(digest(token), Date.now());
}
