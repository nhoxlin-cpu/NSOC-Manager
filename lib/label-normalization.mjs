import {hsCode} from '../public/hs-code.js';
// Preserve each occurrence and its evidence; only consolidate the lookup key.
export function normalizeLabelHistory(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='scans'").get()||!db.prepare('PRAGMA table_info(scans)').all().some(c=>c.name==='raw_barcode'))return;
 const rows=db.prepare("SELECT id,barcode FROM scans WHERE mode='Label' AND raw_barcode IS NULL").all();if(!rows.length)return;
 db.exec('SAVEPOINT label_codes');try{
  const update=db.prepare('UPDATE scans SET barcode=?,raw_barcode=? WHERE id=?');
  for(const row of rows)update.run(hsCode(row.barcode),row.barcode,row.id);
  db.exec('RELEASE SAVEPOINT label_codes');
 }catch(e){db.exec('ROLLBACK TO SAVEPOINT label_codes; RELEASE SAVEPOINT label_codes');throw e;}
}
