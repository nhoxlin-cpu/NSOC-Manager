package vn.hansol.workarea.watch;
import android.app.*;
import android.content.Context;
import android.Manifest;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.json.*;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=30,manifest=Config.NONE)
public class WatchReceptionTest {
 private Context context;
 @Before public void setup(){context=RuntimeEnvironment.getApplication();context.deleteDatabase("watch-history.sqlite");WatchApp.foreground=false;((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).cancelAll();}
 private String event(int n)throws Exception{return new JSONObject().put("schema",1).put("event_id","valid-watch-event-12345-"+n).put("sequence",n).put("scanned_at","2026-11-15T01:00:00Z").put("completed_at","2026-11-15T01:00:01Z").put("status","INFO").put("status_label","Da tra cuu").put("module","HS").put("codes",new JSONArray().put(new JSONObject().put("label","HS").put("raw","1234567890AA").put("normalized","1234567890AA"))).put("fields",new JSONArray()).toString();}
 @Test public void backgroundNotifiesOncePerEventWithoutFullScreenOrInventedOk()throws Exception{assertTrue(WatchReception.result(context,event(2)));assertFalse(WatchReception.result(context,event(2)));assertTrue(WatchReception.result(context,event(1)));NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);assertEquals(2,Shadows.shadowOf(manager).getAllNotifications().size());for(Notification notification:Shadows.shadowOf(manager).getAllNotifications()){assertNull(notification.fullScreenIntent);assertTrue(notification.extras.getString(Notification.EXTRA_TITLE).contains("Da tra cuu"));}assertArrayEquals(new long[]{0,100},manager.getNotificationChannel("workarea-results").getVibrationPattern());try(WatchStore store=new WatchStore(context)){assertEquals(2,store.history().getJSONObject(0).getLong("sequence"));}}
 @Test @Config(sdk=33) public void declinedPermissionKeepsHistoryWithoutBackgroundNotification()throws Exception{Shadows.shadowOf((Application)context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS);assertTrue(WatchReception.result(context,event(1)));NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);assertEquals(0,Shadows.shadowOf(manager).getAllNotifications().size());try(WatchStore store=new WatchStore(context)){assertEquals(1,store.history().length());}}
}
