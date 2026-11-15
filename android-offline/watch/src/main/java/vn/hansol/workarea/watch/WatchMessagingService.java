package vn.hansol.workarea.watch;
import com.google.firebase.messaging.*;
import org.json.JSONObject;
import vn.hansol.workarea.shared.Secrets;
public class WatchMessagingService extends FirebaseMessagingService {
 @Override public void onNewToken(String token){try{Secrets.put(this,"push_token",token);WatchSync.schedule(this,false);}catch(Exception ignored){}}
 @Override public void onMessageReceived(RemoteMessage message){JSONObject pair=WatchStore.pair(this);if(pair!=null&&"workarea_result".equals(message.getData().get("kind"))&&pair.optString("device_id").equals(message.getData().get("device_id")))WatchSync.schedule(this,true);}
 @Override public void onDeletedMessages(){WatchSync.schedule(this,false);}
}
