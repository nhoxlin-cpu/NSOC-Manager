package vn.hansol.workarea.offline;
import android.content.Context;
import androidx.work.*;
import org.json.*;
import vn.hansol.workarea.shared.Secrets;
public class PhoneWatchQueue extends Worker {
 public PhoneWatchQueue(Context context,WorkerParameters params){super(context,params);}
 public static synchronized void add(Context context,JSONObject binding,JSONObject event)throws Exception{JSONArray all=new JSONArray(java.util.Objects.toString(Secrets.get(context,"pending_watch"),"[]")),next=new JSONArray();for(int i=Math.max(0,all.length()-19);i<all.length();i++){JSONObject row=all.getJSONObject(i);if(!row.getJSONObject("event").getString("event_id").equals(event.getString("event_id")))next.put(row);}next.put(new JSONObject().put("owner",binding.getLong("user_id")).put("source",binding.getString("source_id")).put("event",event));Secrets.put(context,"pending_watch",next.toString());}
 public static synchronized boolean flush(Context context)throws Exception{JSONObject binding=new JSONObject(java.util.Objects.toString(Secrets.get(context,"bindings"),"{}"));JSONArray all=new JSONArray(java.util.Objects.toString(Secrets.get(context,"pending_watch"),"[]")),remaining=new JSONArray();for(int i=0;i<all.length();i++){JSONObject row=all.getJSONObject(i),event=row.getJSONObject("event");if(!binding.optBoolean("enabled")||row.getLong("owner")!=binding.optLong("user_id")||!row.getString("source").equals(binding.optString("source_id"))||event.getLong("sequence")<=binding.optLong("gate_seq"))continue;try{JSONArray devices=binding.getJSONArray("devices");for(int j=0;j<devices.length();j++)PhoneWatchBridge.put(context,devices.getJSONObject(j),"EVENT",event.toString(),event.getString("event_id"));}catch(Exception error){remaining.put(row);}}Secrets.put(context,"pending_watch",remaining.toString());return remaining.length()==0;}
 public static void schedule(Context context){WorkManager.getInstance(context).enqueueUniqueWork("workarea-phone-watch-retry",ExistingWorkPolicy.KEEP,new OneTimeWorkRequest.Builder(PhoneWatchQueue.class).build());}
 @Override public Result doWork(){try{return flush(getApplicationContext())?Result.success():Result.retry();}catch(Exception e){return Result.retry();}}
}
