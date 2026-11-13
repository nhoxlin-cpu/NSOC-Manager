import { openDatabase } from '../lib/db.mjs';
const db = openDatabase();
try { console.log(db.prepare('SELECT COUNT(*) n FROM users').get().n); }
finally { db.close(); }
