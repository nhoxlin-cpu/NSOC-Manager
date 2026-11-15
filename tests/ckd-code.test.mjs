import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ckdCode} from '../public/ckd-code.js';
test('CKD identifies Samsung and 12/13-character ITEM independently of scan order',()=>{
 for(const code of ['BN83-25406A','BN83-25406ABN832611110001','AH12-123456A123456'])assert.equal(ckdCode(code)?.slot,'samsung');
 for(const code of ['217010252QTD','2170105252TD','1234567890ABC','12345678901AA'])assert.equal(ckdCode(code)?.slot,'item');
 assert.deepEqual(ckdCode('*217010252QTD*'),{slot:'item',code:'217010252QTD'});
 for(const code of ['P2611140000123','R2611140000123','M2511140000123','3514L91494TD','','123456789012','BN83-25406','ITEM-A'])assert.equal(ckdCode(code),null);
});
