import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { openDatabase } from '../lib/db.mjs';
import { hashPassword, roles } from '../lib/auth.mjs';

if (!process.stdin.isTTY) { console.error('Chạy trong terminal tương tác; Docker dùng docker compose exec app node scripts/create-user.mjs'); process.exit(1); }
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function hiddenQuestion(prompt) {
  process.stdout.write(prompt);
  muted = true;
  try { return await rl.question(''); }
  finally { muted = false; process.stdout.write('\n'); }
}
try {
  const username = (await rl.question('Tên đăng nhập (a-z, số, . _ -): ')).trim().toLowerCase();
  const name = (await rl.question('Họ tên: ')).trim();
  const role = (await rl.question('Quyền (admin / inspector / viewer): ')).trim();
  if (!/^[a-z0-9._-]{3,64}$/.test(username) || !name || name.length > 100 || !roles.includes(role)) throw Error('Tên, họ tên hoặc quyền không hợp lệ.');
  let password;
  while (true) {
    password = await hiddenQuestion('Mật khẩu (8–128 ký tự, không hiển thị): ');
    if (password.length < 8 || password.length > 128) {
      console.log('Mật khẩu cần từ 8 đến 128 ký tự. Hãy nhập lại; thông tin tài khoản được giữ nguyên.');
      continue;
    }
    const confirm = await hiddenQuestion('Nhập lại mật khẩu: ');
    if (password === confirm) break;
    console.log('Hai mật khẩu không khớp. Hãy nhập lại mật khẩu.');
  }
  const hashed = await hashPassword(password), db = openDatabase();
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 && role !== 'admin') throw Error('Tài khoản đầu tiên phải có quyền admin.');
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) throw Error('Tên đăng nhập đã tồn tại.');
  db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run(username, name, hashed, role);
  db.close(); console.log('Đã tạo tài khoản.');
} catch (e) { muted = false; console.error(e.message); process.exitCode = 1; }
finally { rl.close(); }
