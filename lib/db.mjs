import { DatabaseSync } from 'node:sqlite';
import { hsCode } from '../public/hs-code.js';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { scanQuantity } from './scan-quantity.mjs';

export function openDatabase(filename = process.env.DB_PATH || 'data/work-area.sqlite') {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','inspector','viewer')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      navigation TEXT NOT NULL,
      continuous_scan INTEGER NOT NULL DEFAULT 1 CHECK(continuous_scan IN (0,1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      item_code TEXT PRIMARY KEY, samsung TEXT NOT NULL UNIQUE, item TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', maker TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      selling_qty INTEGER NOT NULL CHECK(selling_qty > 0),
      moq INTEGER NOT NULL CHECK(moq > 0)
    );
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
      barcode TEXT NOT NULL, mode TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
      image_type TEXT, image BLOB,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS boxes (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
      delivery TEXT NOT NULL, box_ref TEXT NOT NULL, item_code TEXT NOT NULL REFERENCES materials(item_code),
      label_a TEXT NOT NULL, label_b TEXT NOT NULL, maker TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty > 0), target_qty INTEGER NOT NULL CHECK(target_qty > 0),
      user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(delivery, box_ref)
    );
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
      item_code TEXT NOT NULL REFERENCES materials(item_code), location TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty <> 0), note TEXT NOT NULL DEFAULT '',
      user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS scans_created ON scans(id DESC);
    CREATE INDEX IF NOT EXISTS scans_barcode_mode ON scans(barcode,mode);
    CREATE INDEX IF NOT EXISTS scans_mode_created ON scans(mode,id DESC);
    CREATE INDEX IF NOT EXISTS boxes_delivery ON boxes(delivery, item_code);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS material_stock (
      item_code TEXT PRIMARY KEY REFERENCES materials(item_code) ON DELETE CASCADE,
      qty INTEGER CHECK(qty IS NULL OR (qty > 0 AND qty <= 1000000000)),
      lot_no TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS scan_stock (
      scan_id INTEGER PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
      item_code TEXT, item_name TEXT, maker TEXT, vendor TEXT, lot_no TEXT,
      quantity_source TEXT
    );
    CREATE TABLE IF NOT EXISTS mm_imports (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, sheets TEXT NOT NULL,
      row_count INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mm_inventory (
      barcode TEXT PRIMARY KEY, item_code TEXT NOT NULL, item_name TEXT NOT NULL,
      spec TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL CHECK(qty > 0), lot_no TEXT NOT NULL DEFAULT '',
      maker TEXT NOT NULL DEFAULT '', vendor_code TEXT NOT NULL DEFAULT '', vendor TEXT NOT NULL DEFAULT '',
      storage_location TEXT NOT NULL DEFAULT '', receipt_date TEXT NOT NULL DEFAULT '',
      customer_label TEXT NOT NULL DEFAULT '', label_status TEXT NOT NULL DEFAULT '',
      source_sheet TEXT NOT NULL, source_row INTEGER NOT NULL,
      import_id INTEGER NOT NULL REFERENCES mm_imports(id)
    );
    CREATE INDEX IF NOT EXISTS mm_inventory_item ON mm_inventory(item_code);
    CREATE INDEX IF NOT EXISTS mm_inventory_location ON mm_inventory(location);
    CREATE TABLE IF NOT EXISTS cutting_batches (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, row_count INTEGER NOT NULL, sheets TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cutting_pairs (
      id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES cutting_batches(id),
      model_code TEXT NOT NULL DEFAULT '', model_name TEXT NOT NULL DEFAULT '',
      mi_code TEXT NOT NULL, ai_code TEXT NOT NULL, variant INTEGER NOT NULL CHECK(variant IN (1,2)),
      item_name TEXT NOT NULL DEFAULT '', maker TEXT NOT NULL DEFAULT '', qty TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '', fcn TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL, source_row INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cutting_mi ON cutting_pairs(batch_id,mi_code,model_code);
    CREATE INDEX IF NOT EXISTS cutting_ai ON cutting_pairs(batch_id,ai_code,model_code);
    CREATE TABLE IF NOT EXISTS cutting_scans (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
      code TEXT NOT NULL, snapshot TEXT NOT NULL, image_type TEXT, image BLOB,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (!db.prepare('PRAGMA table_info(user_preferences)').all().some(c=>c.name==='continuous_scan')) db.exec('ALTER TABLE user_preferences ADD COLUMN continuous_scan INTEGER NOT NULL DEFAULT 1 CHECK(continuous_scan IN (0,1))');
  if (!db.prepare('PRAGMA table_info(scans)').all().some(c=>c.name==='quantity')) transaction(db,()=>{
    db.exec('ALTER TABLE scans ADD COLUMN quantity INTEGER CHECK(quantity IS NULL OR (quantity > 0 AND quantity <= 1000000000))');
    const save=db.prepare('UPDATE scans SET quantity=? WHERE id=?');
    for(const row of db.prepare('SELECT id,barcode,mode FROM scans').iterate())save.run(scanQuantity(row.barcode,row.mode),row.id);
  });
  if (!db.prepare('PRAGMA table_info(scans)').all().some(c=>c.name==='prior_count')) transaction(db,()=>{
    db.exec('ALTER TABLE scans ADD COLUMN prior_count INTEGER NOT NULL DEFAULT 0 CHECK(prior_count >= 0)');
    db.exec("UPDATE scans SET prior_count=(SELECT COUNT(*) FROM scans earlier WHERE earlier.mode=scans.mode AND earlier.barcode=scans.barcode AND earlier.id<scans.id) WHERE mode='HS'");
  });
  if (!db.prepare('PRAGMA table_info(scans)').all().some(c=>c.name==='raw_barcode')) transaction(db,()=>{
    db.exec('ALTER TABLE scans ADD COLUMN raw_barcode TEXT');
    const update=db.prepare('UPDATE scans SET raw_barcode=?,barcode=? WHERE id=?');
    for(const row of db.prepare("SELECT id,barcode FROM scans WHERE mode='HS'").all())update.run(row.barcode,hsCode(row.barcode),row.id);
  });
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
