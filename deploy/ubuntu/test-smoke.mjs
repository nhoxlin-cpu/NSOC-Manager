import assert from 'node:assert/strict';
const root='http://127.0.0.1:3000';
const health=await fetch(root+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
const response=await fetch(root+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'restore-admin',password:'ubuntu-fixture-password'})});assert.equal(response.status,200);const {csrf}=await response.json();const cookie=response.headers.get('set-cookie').split(';')[0];
const inventory=await fetch(root+'/api/holding/v2/inventory',{headers:{Cookie:cookie}});assert.equal(inventory.status,200);const stock=await inventory.json();assert.equal(stock.entries[0].barcode,'FIXTURE-BOX');assert.equal(stock.entries[0].remaining_qty,2.5);assert.equal(stock.entries[0].lot_no,'LOT-KEEP');
const backup=await fetch(root+'/api/recovery-backup',{headers:{Cookie:cookie}});assert.equal(backup.status,200);await backup.arrayBuffer();
console.log('Restored sign-in, Holding stock and downloadable recovery verified.');
