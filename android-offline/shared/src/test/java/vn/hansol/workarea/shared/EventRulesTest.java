package vn.hansol.workarea.shared;
import org.junit.Test;
import org.json.*;
import static org.junit.Assert.*;
public class EventRulesTest {
 private String event()throws Exception{return new JSONObject().put("schema",1).put("event_id","a1234567-a123-4123-8123-a123456789ab").put("sequence",2).put("scanned_at","2026-11-15T01:00:00Z").put("completed_at","2026-11-15T01:00:01Z").put("status","INFO").put("status_label","Da tra cuu").put("codes",new JSONArray().put(new JSONObject().put("label","HS").put("raw","1234567890AA-LOT").put("normalized","1234567890AA"))).put("fields",new JSONArray()).toString();}
 @Test public void keepsRawAndNormalizedAndDoesNotInventQuality()throws Exception{JSONObject e=EventRules.parse(event());assertEquals("INFO",e.getString("status"));assertNotEquals(e.getJSONArray("codes").getJSONObject(0).getString("raw"),e.getJSONArray("codes").getJSONObject(0).getString("normalized"));assertFalse(EventRules.newer(1,2));assertTrue(EventRules.newer(3,2));}
 @Test public void rejectsUnspecifiedQuality()throws Exception{JSONObject e=new JSONObject(event()).put("status","OK_GUESSED");assertThrows(Exception.class,()->EventRules.parse(e.toString()));}
 @Test public void signaturesRejectChangedBodyOrOtherPair()throws Exception{String key="a".repeat(64),body="EVENT\npair-one\n"+event(),sig=Secrets.hmac(key,body);assertTrue(Secrets.verify(key,body,sig));assertFalse(Secrets.verify(key,body+"changed",sig));assertFalse(Secrets.verify(key,body.replace("pair-one","pair-two"),sig));assertFalse(Secrets.verify("b".repeat(64),body,sig));}
 @Test public void staleNativeBindingCannotSendAnotherAccountsResult(){assertTrue(EventRules.belongs(1,"phone-a",1,"phone-a"));assertFalse(EventRules.belongs(2,"phone-a",1,"phone-a"));assertFalse(EventRules.belongs(1,"phone-b",1,"phone-a"));assertFalse(EventRules.belongs(0,"phone-a",0,"phone-a"));}
 @Test public void otherWatchCannotReadPairPackets()throws Exception{String key="a".repeat(64),value=event(),one=Secrets.encryptPacket(key,value),two=Secrets.encryptPacket(key,value);assertNotEquals(one,two);assertFalse(one.contains("1234567890AA"));assertEquals(value,Secrets.decryptPacket(key,one));assertThrows(Exception.class,()->Secrets.decryptPacket("b".repeat(64),one));}
}
