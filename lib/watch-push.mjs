import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createSign} from 'node:crypto';
let cached;
const configPath=()=>process.env.WORKAREA_FCM_SERVICE_ACCOUNT||fileURLToPath(new URL('../private/watch-fcm-service-account.json',import.meta.url));
export const watchPushConfigured=()=>existsSync(configPath());
export async function sendWatchPush(token,eventId,deviceId){
 if(!watchPushConfigured())return false;
 const account=JSON.parse(await readFile(configPath(),'utf8'));
 if(!account.project_id||!account.client_email||!account.private_key)throw Error('FCM service account configuration invalid');
 if(!cached||cached.until<Date.now()){
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000),unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),signature=createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('FCM OAuth rejected');const value=await response.json();cached={token:value.access_token,until:Date.now()+3000000};
 }
 const response=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(account.project_id)+'/messages:send',{method:'POST',headers:{Authorization:'Bearer '+cached.token,'Content-Type':'application/json'},body:JSON.stringify({message:{token,data:{kind:'workarea_result',event_id:eventId,device_id:deviceId},android:{priority:'high',ttl:'3600s'}}}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('FCM delivery rejected: '+response.status);return true;
}
export async function flushWatchPush(db){if(!watchPushConfigured())return;const rows=db.prepare('SELECT q.*,d.push_token FROM watch_delivery q JOIN watch_devices d ON d.id=q.device_id JOIN watch_sources s ON s.user_id=d.user_id AND s.source_id=d.source_id JOIN users u ON u.id=d.user_id WHERE d.revoked=0 AND s.enabled=1 AND u.active=1 AND d.push_token IS NOT NULL AND q.next_at<? AND q.attempts<8 LIMIT 20').all(Date.now());for(const row of rows){try{await sendWatchPush(row.push_token,row.event_id,row.device_id);db.prepare('DELETE FROM watch_delivery WHERE device_id=? AND event_id=?').run(row.device_id,row.event_id);}catch{db.prepare('UPDATE watch_delivery SET attempts=attempts+1,next_at=? WHERE device_id=? AND event_id=?').run(Date.now()+Math.min(3600000,15000*2**row.attempts),row.device_id,row.event_id);}}}
