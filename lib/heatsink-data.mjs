import {transaction} from './db.mjs';
export function initHeatsink(db){db.exec(`CREATE TABLE IF NOT EXISTS heatsink_batches(id INTEGER PRIMARY KEY,name TEXT NOT NULL,sheets TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS heatsink_groups(id INTEGER PRIMARY KEY,batch_id INTEGER NOT NULL REFERENCES heatsink_batches(id),sub_code TEXT NOT NULL,heatsink_code TEXT NOT NULL,model TEXT NOT NULL,sheet TEXT NOT NULL,source_row INTEGER NOT NULL,parts TEXT NOT NULL,images TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS heatsink_batch ON heatsink_groups(batch_id);
CREATE TABLE IF NOT EXISTS heatsink_images(id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BLOB NOT NULL);`);}
export function importHeatsink(db,parsed,name){return transaction(db,()=>{
 const id=Number(db.prepare('INSERT INTO heatsink_batches(name,sheets) VALUES (?,?)').run(name,JSON.stringify(parsed.sheets)).lastInsertRowid);
 const image=db.prepare('INSERT OR IGNORE INTO heatsink_images(id,mime,bytes) VALUES (?,?,?)');for(const i of parsed.images)image.run(i.id,i.mime,i.bytes);
 const save=db.prepare('INSERT INTO heatsink_groups(batch_id,sub_code,heatsink_code,model,sheet,source_row,parts,images) VALUES (?,?,?,?,?,?,?,?)');
 for(const g of parsed.groups)save.run(id,g.sub_code,g.heatsink_code,g.model,g.sheet,g.source_row,JSON.stringify(g.parts),JSON.stringify(g.images));
 return {id,groups:parsed.groups.length,parts:parsed.groups.reduce((n,g)=>n+g.parts.length,0),images:parsed.images.length,sheets:parsed.sheets};
});}
export function listHeatsink(db,{q='',model='',offset=0}={}){
 const batch=db.prepare('SELECT * FROM heatsink_batches ORDER BY id DESC LIMIT 1').get();if(!batch)return {batch:null,groups:[],models:[],total:0,next:null};batch.sheets=JSON.parse(batch.sheets);
 q=String(q).trim().toUpperCase().slice(0,200);model=String(model).slice(0,200);offset=Math.max(0,Math.min(100000,Math.floor(Number(offset)||0)));
 const where="batch_id=? AND (?='' OR model=?) AND (?='' OR instr(upper(sub_code),?)>0 OR instr(upper(heatsink_code),?)>0 OR instr(upper(model),?)>0 OR instr(upper(parts),?)>0)",args=[batch.id,model,model,q,q,q,q,q];
 const total=db.prepare('SELECT count(*) n FROM heatsink_groups WHERE '+where).get(...args).n;
 const groups=db.prepare('SELECT * FROM heatsink_groups WHERE '+where+' ORDER BY id LIMIT 30 OFFSET ?').all(...args,offset).map(g=>({...g,parts:JSON.parse(g.parts),images:JSON.parse(g.images)}));
 return {batch,groups,total,next:offset+groups.length<total?offset+groups.length:null,models:db.prepare('SELECT DISTINCT model FROM heatsink_groups WHERE batch_id=? ORDER BY model').all(batch.id).map(r=>r.model)};
}
