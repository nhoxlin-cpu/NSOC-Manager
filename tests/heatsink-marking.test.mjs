import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markingMatches} from '../public/heatsink-match.js';
test('partial marking accepts separated words, mixed case and does not combine vendors',()=>{
 assert.equal(markingMatches('3514006992TF MBRF20U80CTA, 80V, KEC','20u80 kec'),true);
 assert.equal(markingMatches('3514006992TF MBRF20U80CTA, 80V, KEC','20u80 dachang'),false);
 assert.equal(markingMatches('anything','   '),false);
 assert.equal(markingMatches('MBRF20U80CTL DACHANG','20u80ctl'),true);
});
