import initSqlJs from 'sql.js';
import {normalizeLabelHistory} from '../lib/label-normalization.mjs';
let engine;
export async function openDeviceDatabase(bytes){
 engine??=initSqlJs({locateFile:name=>'/offline/'+name});const SQL=await engine,raw=new SQL.Database(new Uint8Array(bytes));raw.run('PRAGMA foreign_keys=ON');
 const convert=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Uint8Array?Buffer.from(value):value]));
 const database={raw,exec:sql=>raw.run(sql),close:()=>raw.close(),prepare(sql){return {
  all(...args){const stmt=raw.prepare(sql);try{stmt.bind(args.map(v=>v===undefined?null:v));const rows=[];while(stmt.step())rows.push(convert(stmt.getAsObject()));return rows;}finally{stmt.free();}},
  get(...args){const stmt=raw.prepare(sql);try{stmt.bind(args.map(v=>v===undefined?null:v));return stmt.step()?convert(stmt.getAsObject()):undefined;}finally{stmt.free();}},
  run(...args){raw.run(sql,args.map(v=>v===undefined?null:v));return {changes:raw.getRowsModified(),lastInsertRowid:raw.exec('SELECT last_insert_rowid() id')[0]?.values[0][0]??0};}
 };}};normalizeLabelHistory(database);return database;
}
