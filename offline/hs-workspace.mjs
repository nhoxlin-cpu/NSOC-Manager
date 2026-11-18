export function initHsWorkspace(db,user){
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE materials(item_code TEXT PRIMARY KEY,samsung TEXT,item TEXT,maker TEXT,vendor TEXT);
 CREATE TABLE scans(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,barcode TEXT NOT NULL,raw_barcode TEXT,mode TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),image_type TEXT,image BLOB,quantity REAL,prior_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX hs_scan_code ON scans(mode,barcode);
 CREATE TABLE scan_stock(scan_id INTEGER PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,item_code TEXT,item_name TEXT,maker TEXT,vendor TEXT,lot_no TEXT,quantity_source TEXT);
 CREATE TABLE offline_settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 db.prepare('INSERT INTO users(id,username,name,password,role) VALUES(?,?,?,?,?)').run(user.id,user.username,user.name,'OFFLINE-DISABLED',user.role);
}
// A starter workspace contains HS occurrences only; other workflows need their own live data.
export function hsWorkspacePath(path,{method='GET',data={}}={},viewMode=''){
 const url=new URL(path,'https://workarea.invalid'),p=url.pathname,mode=data.mode||url.searchParams.get('mode');
 if(p==='/scans')return mode==='HS';
 if(p==='/scans/check'||p==='/scans/delete')return mode==='HS';
 if(p==='/export/scans'||p==='/export'&&url.searchParams.get('kind')==='scans')return mode==='HS';
 if(/^\/scans\/\d+(?:\/image)?$/.test(p))return viewMode==='HS';
 return false;
}
