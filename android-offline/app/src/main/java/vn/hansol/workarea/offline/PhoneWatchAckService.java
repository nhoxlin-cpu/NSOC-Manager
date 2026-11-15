package vn.hansol.workarea.offline;
import com.google.android.gms.wearable.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import vn.hansol.workarea.shared.Secrets;
public class PhoneWatchAckService extends WearableListenerService {
 @Override public void onMessageReceived(MessageEvent event){try{if(!event.getPath().startsWith("/workarea/ack/"))return;String pair=event.getPath().substring("/workarea/ack/".length());JSONObject wrapper=new JSONObject(new String(event.getData(),StandardCharsets.UTF_8)),bindings=new JSONObject(java.util.Objects.toString(Secrets.get(this,"bindings"),"{}"));JSONArray devices=bindings.optJSONArray("devices");if(devices==null)return;for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i);if(d.getString("id").equals(pair)&&Secrets.verify(d.getString("data_key"),"ACK\n"+pair+"\n"+wrapper.getString("body"),wrapper.getString("sig")))getSharedPreferences("watch-state",0).edit().putLong("last_ack",System.currentTimeMillis()).apply();}}catch(Exception ignored){}}
}
