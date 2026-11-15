package vn.hansol.workarea.watch;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.json.*;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=30,manifest=Config.NONE)
public class WatchStoreTest {
 private WatchStore store;
 @Before public void setup(){RuntimeEnvironment.getApplication().deleteDatabase("watch-history.sqlite");store=new WatchStore(RuntimeEnvironment.getApplication());}
 @After public void close(){store.close();}
 private String event(int seq)throws Exception{return new JSONObject().put("schema",1).put("event_id","event-id-1234567890-"+seq).put("sequence",seq).put("scanned_at","2026-11-15T01:00:00Z").put("completed_at","2026-11-15T01:00:01Z").put("status","INFO").put("codes",new JSONArray().put(new JSONObject().put("label","HS").put("raw","1234567890AA").put("normalized","1234567890AA"))).put("fields",new JSONArray()).toString();}
 @Test public void actualSqliteDeduplicatesKeepsTwentyAndDoesNotLetSlowResultReplaceNewer()throws Exception{assertTrue(store.accept(event(2)));assertTrue(store.accept(event(1)));assertFalse(store.accept(event(2)));assertEquals(2,store.history().getJSONObject(0).getLong("sequence"));for(int seq=3;seq<=30;seq++)assertTrue(store.accept(event(seq)));assertEquals(20,store.history().length());assertEquals(30,store.history().getJSONObject(0).getLong("sequence"));assertFalse(store.accept(event(1)));}
 @Test public void disablingRejectsOldEventsAndLateDisableCannotOverwriteNewSession()throws Exception{store.accept(event(1));store.gate(5,false);assertFalse(store.accept(event(4)));assertTrue(store.accept(event(6)));store.gate(5,false);assertEquals(1,store.state("enabled",1));assertTrue(store.accept(event(7)));}
}
