let sequence=0;
export function transaction(db,fn){const name='device_tx_'+(++sequence);db.exec('SAVEPOINT '+name);try{const result=fn();db.exec('RELEASE SAVEPOINT '+name);return result;}catch(error){db.exec('ROLLBACK TO SAVEPOINT '+name+'; RELEASE SAVEPOINT '+name);throw error;}}
