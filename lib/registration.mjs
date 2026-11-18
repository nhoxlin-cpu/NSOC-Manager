import {transaction} from './db.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function initRegistration(db){db.exec(`
 CREATE TABLE IF NOT EXISTS registration_settings(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN ('auto','manual')),updated_by INTEGER REFERENCES users(id),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 INSERT OR IGNORE INTO registration_settings(id,mode) VALUES(1,'auto');
 CREATE TABLE IF NOT EXISTS registration_requests(user_id INTEGER PRIMARY KEY REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),created_mode TEXT NOT NULL CHECK(created_mode IN ('auto','manual')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT,reviewed_by INTEGER REFERENCES users(id));
 CREATE INDEX IF NOT EXISTS registration_pending ON registration_requests(status,user_id);
`);}
export const registrationMode=db=>db.prepare('SELECT mode FROM registration_settings WHERE id=1').get()?.mode||'auto';
export function setRegistrationMode(db,mode,adminId){if(!['auto','manual'].includes(mode))fail(400,'Chọn tự động duyệt hoặc duyệt thủ công.');db.prepare('UPDATE registration_settings SET mode=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(mode,adminId);return {mode};}
export function registerEmployee(db,{username,name,password}){return transaction(db,()=>{
 if(db.prepare('SELECT id FROM users WHERE username=?').get(username))fail(409,'Tên đăng nhập đã tồn tại. Vui lòng chọn tên khác.');
 const mode=registrationMode(db),pending=mode==='manual';
 const id=Number(db.prepare("INSERT INTO users(username,name,password,role,active) VALUES (?,?,?,'inspector',?)").run(username,name,password,pending?0:1).lastInsertRowid);
 db.prepare("INSERT INTO registration_requests(user_id,status,created_mode,reviewed_at) VALUES (?,?,?,CASE WHEN ?='auto' THEN CURRENT_TIMESTAMP ELSE NULL END)").run(id,pending?'pending':'approved',mode,mode);
 return {ok:true,username,pending};
});}
export function pendingRegistrations(db,offset=0){offset=Math.max(0,Math.floor(Number(offset)||0));const rows=db.prepare("SELECT r.user_id,u.username,u.name,r.created_at FROM registration_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.user_id LIMIT 51 OFFSET ?").all(offset);return {mode:registrationMode(db),pending:rows.slice(0,50),total:db.prepare("SELECT count(*) n FROM registration_requests WHERE status='pending'").get().n,next:rows.length>50?offset+50:null};}
export function reviewRegistration(db,id,decision,adminId){if(!Number.isSafeInteger(id)||id<1||!['approve','reject'].includes(decision))fail(400,'Yêu cầu duyệt không hợp lệ.');return transaction(db,()=>{
 const row=db.prepare('SELECT r.status,u.role FROM registration_requests r JOIN users u ON u.id=r.user_id WHERE r.user_id=?').get(id);if(!row)fail(404,'Không tìm thấy đăng ký.');
 const status=decision==='approve'?'approved':'rejected';if(row.status===status)return {ok:true,status,duplicate:true};if(row.status!=='pending')fail(409,'Đăng ký đã được xử lý. Tải lại danh sách.');if(row.role!=='inspector')fail(409,'Quyền tài khoản đã thay đổi. Kiểm tra lại trước khi duyệt.');
 db.prepare('UPDATE users SET active=? WHERE id=?').run(decision==='approve'?1:0,id);
 db.prepare('UPDATE registration_requests SET status=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE user_id=?').run(status,adminId,id);
 return {ok:true,status};
});}
