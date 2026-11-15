package vn.hansol.workarea.watch;
import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import vn.hansol.workarea.shared.Secrets;
public class WatchApp extends Application {
 public static volatile boolean foreground=false;
 public static boolean pushReady(){return !BuildConfig.FIREBASE_APP_ID.isEmpty()&&!BuildConfig.FIREBASE_API_KEY.isEmpty()&&!BuildConfig.FIREBASE_PROJECT_ID.isEmpty()&&!BuildConfig.FIREBASE_SENDER_ID.isEmpty();}
 @Override public void onCreate(){super.onCreate();if(BuildConfig.FIREBASE_APP_ID.isEmpty()||BuildConfig.FIREBASE_API_KEY.isEmpty()||BuildConfig.FIREBASE_PROJECT_ID.isEmpty()||BuildConfig.FIREBASE_SENDER_ID.isEmpty())return;try{if(FirebaseApp.getApps(this).isEmpty())FirebaseApp.initializeApp(this,new FirebaseOptions.Builder().setApplicationId(BuildConfig.FIREBASE_APP_ID).setApiKey(BuildConfig.FIREBASE_API_KEY).setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build());FirebaseMessaging.getInstance().setAutoInitEnabled(true);FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token->{try{Secrets.put(this,"push_token",token);WatchSync.schedule(this,false);}catch(Exception ignored){}});}catch(Exception ignored){}}
}
