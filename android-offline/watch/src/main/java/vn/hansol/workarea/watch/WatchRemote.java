package vn.hansol.workarea.watch;
import android.content.Context;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
public final class WatchRemote {
 public static final String ORIGIN="https://work-area.odermenu.duckdns.org";
 public static JSONObject call(Context c,String path,JSONObject body,boolean auth)throws Exception{
  if(!path.startsWith("/api/watch/"))throw new Exception("Invalid API path");HttpURLConnection connection=(HttpURLConnection)new URL(ORIGIN+path).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(25000);connection.setRequestProperty("Accept","application/json");if(auth){JSONObject pair=WatchStore.pair(c);if(pair==null)throw new Exception("Chưa ghép đôi");connection.setRequestProperty("Authorization","Bearer "+pair.getString("token"));}
  try{if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
   int status=connection.getResponseCode();InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();if(input==null)throw new Exception("Server chưa sẵn sàng");ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(input){byte[] buffer=new byte[4096];int n;while((n=input.read(buffer))!=-1){bytes.write(buffer,0,n);if(bytes.size()>300000)throw new Exception("Response too large");}}JSONObject result=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));if(status==401&&auth){vn.hansol.workarea.shared.Secrets.clear(c,"pair");((android.app.NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancelAll();WatchAlerts.changed(c);}if(status>=400)throw new Exception(result.optString("error","Server error "+status));return result;
  }finally{connection.disconnect();}
 }
}
