package vn.hansol.workarea.watch;
import android.content.Context;
import com.google.android.gms.wearable.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import vn.hansol.workarea.shared.Secrets;
public class WatchDataService extends WearableListenerService {
 @Override public void onDataChanged(DataEventBuffer events){for(DataEvent event:events)if(event.getType()==DataEvent.TYPE_CHANGED)consume(this,event.getDataItem());}
 public static void consume(Context context,DataItem item){try{JSONObject pair=WatchStore.pair(context);if(pair==null)return;DataMap map=DataMapItem.fromDataItem(item).getDataMap();String id=map.getString("pair"),kind=map.getString("kind"),body=map.getString("body"),signature=map.getString("sig");if(!pair.getString("device_id").equals(id)||!Secrets.verify(pair.getString("data_key"),kind+"\n"+id+"\n"+body,signature))return;body=Secrets.decryptPacket(pair.getString("data_key"),body);String path=item.getUri().getPath();
  try(WatchStore store=new WatchStore(context)){if("CONTROL".equals(kind)&&("/workarea/control/"+id).equals(path)){JSONObject value=new JSONObject(body);if(value.getLong("user_id")!=pair.getLong("user_id")||!value.getString("source_id").equals(pair.getString("source_id")))return;store.gate(value.getLong("sequence"),value.getBoolean("enabled"));WatchAlerts.changed(context);}
   else if("EVENT".equals(kind)){JSONObject event=vn.hansol.workarea.shared.EventRules.parse(body);if(!("/workarea/result/"+id+"/"+event.getString("event_id")).equals(path))return;WatchReception.result(context,body);String ack=new JSONObject().put("event_id",event.getString("event_id")).put("sequence",event.getLong("sequence")).toString();JSONObject wrapper=new JSONObject().put("body",ack).put("sig",Secrets.hmac(pair.getString("data_key"),"ACK\n"+id+"\n"+ack));Wearable.getMessageClient(context).sendMessage(item.getUri().getHost(),"/workarea/ack/"+id,wrapper.toString().getBytes(StandardCharsets.UTF_8));}}
  context.getSharedPreferences("watch-state",0).edit().putLong("phone_seen",System.currentTimeMillis()).apply();
 }catch(Exception ignored){}}
}
