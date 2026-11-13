import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
const source = resolve(process.env.DB_PATH || 'data/work-area.sqlite');
if (!existsSync(source)) throw Error('Chưa có cơ sở dữ liệu để sao lưu.');
const directory = join(dirname(source), 'backups');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const filename = join(directory, `work-area-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db = new DatabaseSync(source);
try { db.prepare('VACUUM INTO ?').run(filename); console.log(`Đã sao lưu: ${filename}`); }
finally { db.close(); }
