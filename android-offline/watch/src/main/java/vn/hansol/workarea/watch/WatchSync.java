package vn.hansol.workarea.watch;
import android.content.Context;
import androidx.work.*;
import org.json.*;
import vn.hansol.workarea.shared.Secrets;
public class WatchSync extends Worker {
 public WatchSync(Context c,WorkerParameters p){super(c,p);}
 public static void schedule(Context c,boolean urgent){OneTimeWorkRequest.Builder builder=new OneTimeWorkRequest.Builder(WatchSync.class).setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build());if(urgent&&android.os.Build.VERSION.SDK_INT>=31)builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST);WorkManager.getInstance(c).enqueueUniqueWork("workarea-watch-push",ExistingWorkPolicy.APPEND_OR_REPLACE,builder.build());}
 public static void pull(Context c,boolean wait)throws Exception{JSONObject pair=WatchStore.pair(c);if(pair==null)return;String token=Secrets.get(c,"push_token");if(token!=null&&!token.equals(c.getSharedPreferences("watch-state",0).getString("registered_push",""))){WatchRemote.call(c,"/api/watch/device/push-token",new JSONObject().put("token",token),true);c.getSharedPreferences("watch-state",0).edit().putString("registered_push",token).apply();}
  long latest;try(WatchStore store=new WatchStore(c)){latest=store.latest();}JSONObject result=WatchRemote.call(c,"/api/watch/device/events?after="+latest+(wait?"&wait=1":""),null,true);JSONObject current=WatchStore.pair(c);if(current==null||!current.getString("device_id").equals(pair.getString("device_id")))return;
  c.getSharedPreferences("watch-state",0).edit().putLong("server_seen",System.currentTimeMillis()).putBoolean("push_configured",result.optBoolean("push_configured")).apply();try(WatchStore store=new WatchStore(c)){store.gate(result.optLong("gate_seq"),result.optBoolean("enabled"));JSONArray events=result.getJSONArray("events");for(int i=events.length()-1;i>=0;i--){JSONObject event=events.getJSONObject(i);WatchReception.result(c,event.toString());}}WatchAlerts.changed(c);
 }
 @Override public Result doWork(){try{pull(getApplicationContext(),false);return Result.success();}catch(Exception e){return getRunAttemptCount()<5?Result.retry():Result.failure();}}
}
