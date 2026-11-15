package vn.hansol.workarea.shared;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.Arrays;
public final class EventRules {
 public static JSONObject parse(String value) throws Exception {
  if(value==null||value.length()>14000)throw new Exception("Event too large");JSONObject event=new JSONObject(value);
  if(event.optInt("schema")!=1||!event.getString("event_id").matches("[a-zA-Z0-9-]{16,80}")||(event.getLong("sequence")<1||event.getLong("sequence")>9007199254740991L))throw new Exception("Invalid event identity");
  Instant.parse(event.getString("scanned_at"));Instant.parse(event.getString("completed_at"));
  if(!Arrays.asList("PASS","NG","NOT_FOUND","INFO","DUPLICATE","PENDING").contains(event.getString("status")))throw new Exception("Invalid result status");
  JSONArray codes=event.getJSONArray("codes"),fields=event.getJSONArray("fields");if(codes.length()<1||codes.length()>2||fields.length()>12)throw new Exception("Invalid result fields");
  for(int i=0;i<codes.length();i++){JSONObject code=codes.getJSONObject(i);if(code.getString("raw").isEmpty()||code.getString("normalized").isEmpty()||code.getString("raw").length()>500||code.getString("normalized").length()>500||code.getString("label").length()>30)throw new Exception("Code too long");}
  for(int i=0;i<fields.length();i++)if(fields.getJSONObject(i).getString("label").length()>60||fields.getJSONObject(i).getString("value").length()>320)throw new Exception("Field too long");
  if(event.optString("title").length()>200||event.optString("status_label").length()>100)throw new Exception("Text too long");return event;
 }
 public static boolean newer(long incoming,long current){return incoming>current;}
 public static boolean belongs(long user,String source,long expectedUser,String expectedSource){return user>0&&user==expectedUser&&source!=null&&source.equals(expectedSource);}
}
