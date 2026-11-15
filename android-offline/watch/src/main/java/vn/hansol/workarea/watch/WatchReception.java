package vn.hansol.workarea.watch;
import android.content.Context;
import org.json.JSONObject;
public final class WatchReception {
 public static boolean result(Context context,String value)throws Exception{boolean added;try(WatchStore store=new WatchStore(context)){added=store.accept(value);}if(added)WatchAlerts.result(context,new JSONObject(value));return added;}
}
