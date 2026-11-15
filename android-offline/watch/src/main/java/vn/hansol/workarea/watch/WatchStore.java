package vn.hansol.workarea.watch;
import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;
import vn.hansol.workarea.shared.Secrets;
import vn.hansol.workarea.shared.EventRules;

public class WatchStore extends SQLiteOpenHelper {
 public WatchStore(Context c){super(c,"watch-history.sqlite",null,1);}
 @Override public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE events(event_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL UNIQUE,payload TEXT)");db.execSQL("CREATE TABLE state(key TEXT PRIMARY KEY,value INTEGER NOT NULL)");}
 @Override public void onUpgrade(SQLiteDatabase db,int a,int b){}
 public static JSONObject pair(Context c){try{String value=Secrets.get(c,"pair");return value==null?null:new JSONObject(value);}catch(Exception e){return null;}}
 public static void pair(Context c,JSONObject p)throws Exception{try(WatchStore store=new WatchStore(c)){store.getWritableDatabase().delete("events",null,null);store.getWritableDatabase().delete("state",null,null);}Secrets.put(c,"pair",p.toString());}
 public long state(String key,long fallback){try(Cursor row=getReadableDatabase().rawQuery("SELECT value FROM state WHERE key=?",new String[]{key})){return row.moveToFirst()?row.getLong(0):fallback;}}
 private void set(String key,long value){ContentValues values=new ContentValues();values.put("key",key);values.put("value",value);getWritableDatabase().insertWithOnConflict("state",null,values,SQLiteDatabase.CONFLICT_REPLACE);}
 public synchronized void gate(long sequence,boolean enabled){SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{if(sequence>=state("gate",0)&&sequence>=latest()){set("gate",sequence);set("enabled",enabled?1:0);}db.setTransactionSuccessful();}finally{db.endTransaction();}}
 public synchronized boolean accept(String value)throws Exception{JSONObject event=EventRules.parse(value);SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{long seq=event.getLong("sequence");if(seq<=state("gate",0))return false;if(state("enabled",1)==0)set("enabled",1);ContentValues row=new ContentValues();row.put("event_id",event.getString("event_id"));row.put("sequence",seq);row.put("payload",event.toString());long result=db.insertWithOnConflict("events",null,row,SQLiteDatabase.CONFLICT_IGNORE);if(result<0)return false;db.execSQL("UPDATE events SET payload=NULL WHERE event_id NOT IN(SELECT event_id FROM events ORDER BY sequence DESC LIMIT 20)");db.setTransactionSuccessful();return true;}finally{db.endTransaction();}}
 public JSONArray history(){JSONArray out=new JSONArray();try(Cursor rows=getReadableDatabase().rawQuery("SELECT payload FROM events WHERE payload IS NOT NULL ORDER BY sequence DESC LIMIT 20",null)){while(rows.moveToNext())try{out.put(new JSONObject(rows.getString(0)));}catch(Exception ignored){}}return out;}
 public long latest(){try(Cursor c=getReadableDatabase().rawQuery("SELECT COALESCE(MAX(sequence),0) FROM events",null)){return c.moveToFirst()?c.getLong(0):0;}}
}
