package vn.hansol.workarea.watch;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import org.json.JSONObject;
public final class WatchAlerts {
 public static final String CHANGED="vn.hansol.workarea.WATCH_CHANGED";
 public static void changed(Context c){c.sendBroadcast(new Intent(CHANGED).setPackage(c.getPackageName()));}
 public static void result(Context c,JSONObject e){changed(c);try{
  if(WatchApp.foreground){Vibrator v=Build.VERSION.SDK_INT>=31?((VibratorManager)c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator():(Vibrator)c.getSystemService(Context.VIBRATOR_SERVICE);if(v!=null&&v.hasVibrator())v.vibrate(VibrationEffect.createOneShot(100,VibrationEffect.DEFAULT_AMPLITUDE));return;}
  if(Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
  NotificationManager manager=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);if(!manager.areNotificationsEnabled())return;NotificationChannel channel=new NotificationChannel("workarea-results","Work Area · Kết quả quét",NotificationManager.IMPORTANCE_DEFAULT);channel.enableVibration(true);channel.setVibrationPattern(new long[]{0,100});channel.setSound(null,null);manager.createNotificationChannel(channel);
  PendingIntent open=PendingIntent.getActivity(c,0,new Intent(c,WatchActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);String code=e.getJSONArray("codes").getJSONObject(0).getString("normalized"),text=code+(e.optString("title").isEmpty()?"":" · "+e.optString("title"));Notification notification=new Notification.Builder(c,"workarea-results").setSmallIcon(vn.hansol.workarea.watch.R.drawable.ic_workarea).setContentTitle(e.optString("module")+" · "+e.optString("status_label")).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text+"\nLịch sử quét · "+e.getString("scanned_at"))).setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE).setWhen(java.time.Instant.parse(e.getString("scanned_at")).toEpochMilli()).setSortKey(String.format("%019d",e.getLong("sequence"))).build();manager.notify(e.getString("event_id"),1,notification);
 }catch(Exception ignored){}}
}
