package vn.hansol.workarea.offline;
import android.app.Activity;
import android.webkit.JavascriptInterface;
import com.google.android.gms.wearable.*;
import com.google.android.gms.tasks.Tasks;
import vn.hansol.workarea.shared.Secrets;
import vn.hansol.workarea.shared.EventRules;
import org.json.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.ArrayList;

public final class PhoneWatchBridge {
 private final Activity activity;private final BooleanSupplier trusted;private final ExecutorService worker=Executors.newSingleThreadExecutor();private volatile int nodes=-1;private volatile String error="";
 public PhoneWatchBridge(Activity activity,BooleanSupplier trusted){this.activity=activity;this.trusted=trusted;worker.execute(this::nodes);}
 private void execute(Runnable job){activity.runOnUiThread(()->{if(trusted.getAsBoolean())worker.execute(job);});}
 @JavascriptInterface public String status(){return "{\"nodes\":"+nodes+",\"last_ack\":"+activity.getSharedPreferences("watch-state",0).getLong("last_ack",0)+",\"error\":"+JSONObject.quote(error)+"}";}
 @JavascriptInterface public void bind(String value){if(value==null||value.length()>10000)return;execute(()->{try{
  JSONObject next=new JSONObject(value),old=new JSONObject(java.util.Objects.toString(Secrets.get(activity,"bindings"),"{}"));JSONArray devices=next.optJSONArray("devices");if(devices==null||devices.length()>3)throw new Exception("Invalid watch list");long user=next.optLong("user_id");String source=next.optString("source_id");boolean enabled=next.optBoolean("enabled");if(user>0&&!source.matches("[a-zA-Z0-9-]{16,80}"))throw new Exception("Invalid source");
  boolean same=user==old.optLong("user_id")&&source.equals(old.optString("source_id")),changed=!same||enabled!=old.optBoolean("enabled");long gate=Math.max(next.optLong("gate_seq"),same?old.optLong("gate_seq"):0);if(changed&&old.optLong("user_id")>0)gate=Math.max(gate,activity.getSharedPreferences("watch-state",0).getLong("last_sequence",0));
  for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i);if(!d.getString("id").matches("[a-zA-Z0-9-]{16,80}")||!d.getString("data_key").matches("[a-f0-9]{64}"))throw new Exception("Invalid watch key");}
  next.put("gate_seq",gate);Secrets.put(activity,"bindings",next.toString());
  JSONArray prior=old.optJSONArray("devices");if(prior!=null)for(int i=0;i<prior.length();i++){JSONObject d=prior.getJSONObject(i);boolean retained=false;for(int j=0;j<devices.length();j++)if(devices.getJSONObject(j).optString("id").equals(d.optString("id")))retained=true;if(!same||!retained)try{control(old,d,gate,false);}catch(Exception ignored){}}
  for(int i=0;i<devices.length();i++)try{control(next,devices.getJSONObject(i),gate,enabled);}catch(Exception ignored){}try{if(!PhoneWatchQueue.flush(activity))PhoneWatchQueue.schedule(activity);}catch(Exception ignored){PhoneWatchQueue.schedule(activity);}nodes();
 }catch(Exception e){error="Chưa cập nhật được ghép đôi";}});}
 @JavascriptInterface public void result(String value){if(value==null||value.length()>14000)return;execute(()->{try{
  JSONObject envelope=new JSONObject(value),binding=new JSONObject(java.util.Objects.toString(Secrets.get(activity,"bindings"),"{}"));if(!EventRules.belongs(envelope.optLong("user_id"),envelope.optString("source_id"),binding.optLong("user_id"),binding.optString("source_id")))return;JSONObject event=EventRules.parse(envelope.getJSONObject("event").toString());if(!binding.optBoolean("enabled")||event.getLong("sequence")<=binding.optLong("gate_seq"))return;activity.getSharedPreferences("watch-state",0).edit().putLong("last_sequence",event.getLong("sequence")).commit();JSONArray devices=binding.optJSONArray("devices");if(devices==null)return;PhoneWatchQueue.add(activity,binding,event);if(!PhoneWatchQueue.flush(activity))PhoneWatchQueue.schedule(activity);nodes();
 }catch(Exception e){error="Chưa gửi được qua Data Layer; lịch sử vẫn ở điện thoại";}});}
 private void control(JSONObject binding,JSONObject device,long gate,boolean enabled)throws Exception{JSONObject control=new JSONObject().put("enabled",enabled).put("sequence",gate).put("user_id",binding.optLong("user_id")).put("source_id",binding.optString("source_id"));put(activity,device,"CONTROL",control.toString(),"control");}
 public static void put(android.content.Context context,JSONObject device,String kind,String body,String eventId)throws Exception{
  body=Secrets.encryptPacket(device.getString("data_key"),body);String pair=device.getString("id"),path=kind.equals("CONTROL")?"/workarea/control/"+pair:"/workarea/result/"+pair+"/"+eventId;PutDataMapRequest request=PutDataMapRequest.create(path);DataMap map=request.getDataMap();map.putString("pair",pair);map.putString("kind",kind);map.putString("body",body);map.putString("sig",Secrets.hmac(device.getString("data_key"),kind+"\n"+pair+"\n"+body));Tasks.await(Wearable.getDataClient(context).putDataItem(request.asPutDataRequest().setUrgent()),10,TimeUnit.SECONDS);
  if(kind.equals("EVENT")){String key="items-"+pair;JSONArray old=new JSONArray(context.getSharedPreferences("watch-state",0).getString(key,"[]"));ArrayList<String> paths=new ArrayList<>();for(int i=0;i<old.length();i++)if(!old.getString(i).equals(path))paths.add(old.getString(i));paths.add(path);while(paths.size()>20){String stale=paths.remove(0);Wearable.getDataClient(context).deleteDataItems(new android.net.Uri.Builder().scheme("wear").authority("*").path(stale).build());}context.getSharedPreferences("watch-state",0).edit().putString(key,new JSONArray(paths).toString()).apply();}
 }
 private void nodes(){try{nodes=Tasks.await(Wearable.getNodeClient(activity).getConnectedNodes(),8,TimeUnit.SECONDS).size();error="";}catch(Exception e){nodes=-1;error="Chưa kết nối Data Layer";}}
 public void close(){worker.shutdown();}
}
