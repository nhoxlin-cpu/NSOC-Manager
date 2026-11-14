import { transaction } from './db.mjs';
const normalize=v=>String(v??'').trim().toUpperCase();
export function cuttingStatus(db){
  const batch=db.prepare('SELECT id,name,row_count,sheets,created_at FROM cutting_batches ORDER BY id DESC LIMIT 1').get();
  if(!batch)return {batch:null,models:[]};
  batch.sheets=JSON.parse(batch.sheets);
  return {batch,models:db.prepare("SELECT DISTINCT model_code,model_name FROM cutting_pairs WHERE batch_id=? AND model_code<>'' ORDER BY model_code LIMIT 500").all(batch.id)};
}
export function importCutting(db,parsed,name,userId){
  return transaction(db,()=>{
    const id=Number(db.prepare('INSERT INTO cutting_batches(name,row_count,sheets,user_id) VALUES (?,?,?,?)').run(name,parsed.pairs.length,JSON.stringify(parsed.sheets),userId).lastInsertRowid);
    const keys=['model_code','model_name','mi_code','ai_code','variant','item_name','maker','qty','location','fcn','source_sheet','source_row'];
    const save=db.prepare(`INSERT INTO cutting_pairs(batch_id,${keys.join(',')}) VALUES (?,${keys.map(()=>'?').join(',')})`);
    for(const pair of parsed.pairs)save.run(id,...keys.map(k=>pair[k]??''));
    return {id,name,pairs:parsed.pairs.length,sheets:parsed.sheets};
  });
}
export function lookupCutting(db,{code,model='',direction='auto'}){
  code=normalize(code);model=normalize(model);
  if(!code||code.length>200)throw Error('Nhập hoặc quét mã AI / MI từ 1 đến 200 ký tự.');
  if(model.length>200)throw Error('Model quá dài.');
  if(!['auto','AI_TO_MI','MI_TO_AI'].includes(direction))throw Error('Chiều quy đổi không hợp lệ.');
  const batch=db.prepare('SELECT id,name,created_at FROM cutting_batches ORDER BY id DESC LIMIT 1').get();
  if(!batch)return {code,model,direction,batch:null,matches:[],count:0};
  const filter=direction==='auto'?'(mi_code=? OR ai_code=?)':direction==='MI_TO_AI'?'mi_code=?':'ai_code=?';
  const params=direction==='auto'?[code,code]:[code];
  const where=`batch_id=? AND ${filter} AND (?='' OR model_code=?)`;
  const count=db.prepare(`SELECT COUNT(*) n FROM cutting_pairs WHERE ${where}`).get(batch.id,...params,model,model).n;
  const rows=db.prepare(`SELECT * FROM cutting_pairs WHERE ${where} ORDER BY model_code,variant,id LIMIT 200`).all(batch.id,...params,model,model);
  const matches=rows.flatMap(row=>{
    const directions=direction!=='auto'?[direction]:[...(row.mi_code===code?['MI_TO_AI']:[]),...(row.ai_code===code?['AI_TO_MI']:[])];
    return directions.map(d=>({...row,direction:d,source_code:code,target_code:d==='MI_TO_AI'?row.ai_code:row.mi_code}));
  });
  return {code,model,direction,batch,matches,count,truncated:count>rows.length,ambiguous_direction:new Set(matches.map(m=>m.direction)).size>1,multiple_targets:new Set(matches.map(m=>m.target_code)).size>1};
}
export function saveCuttingScan(db,{request_id,user_id,code,model,direction,image}){
  return transaction(db,()=>{
    const previous=db.prepare('SELECT id,user_id,snapshot FROM cutting_scans WHERE request_id=?').get(request_id);
    if(previous){if(previous.user_id!==user_id)throw Error('Mã yêu cầu đã thuộc tài khoản khác.');return {id:previous.id,duplicate:true,...JSON.parse(previous.snapshot)};}
    const result=lookupCutting(db,{code,model,direction});
    if(!result.batch)throw Error('Chưa có bảng quy đổi. Quản trị viên cần nhập file Excel.');
    const id=Number(db.prepare('INSERT INTO cutting_scans(request_id,user_id,code,snapshot,image_type,image) VALUES (?,?,?,?,?,?)').run(request_id,user_id,result.code,JSON.stringify(result),image.mime,image.buffer).lastInsertRowid);
    return {id,...result};
  });
}
