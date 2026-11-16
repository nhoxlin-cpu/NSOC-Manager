package vn.hansol.workarea.offline;
import android.app.*;
import android.content.Intent;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

public final class AppUpdates {
 private final Activity activity;private final BooleanSupplier trusted;
 private final ExecutorService io=Executors.newSingleThreadExecutor();private final AtomicBoolean busy=new AtomicBoolean();
 private File ready;private boolean waitingPermission,closed;
 AppUpdates(Activity a,BooleanSupplier t){activity=a;trusted=t;}
 private long code(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
 @JavascriptInterface public String version(){try{PackageInfo p=activity.getPackageManager().getPackageInfo(activity.getPackageName(),0);return new JSONObject().put("code",code(p)).put("name",p.versionName).toString();}catch(Exception e){return "null";}}
 private void notice(String text){activity.runOnUiThread(()->{if(!closed)Toast.makeText(activity,text,Toast.LENGTH_LONG).show();});}
 @JavascriptInterface public void installLatest(){activity.runOnUiThread(()->{
  if(closed||!trusted.getAsBoolean())return;if(busy.get()){notice("Đang tải bản cập nhật.");return;}
  new AlertDialog.Builder(activity).setTitle("Cập nhật Work Area").setMessage("Tải APK mới và mở trình cài đặt Android. Dữ liệu được giữ lại; không gỡ ứng dụng đang dùng.").setNegativeButton("Để sau",null).setPositiveButton("Tải và cập nhật",(d,w)->download()).show();
 });}
 private HttpURLConnection connect(String url)throws Exception{
  if(!UrlPolicy.trusted(url))throw new IOException("Địa chỉ cập nhật không hợp lệ");HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(120000);c.setRequestProperty("Cache-Control","no-cache");return c;
 }
 private void download(){if(!busy.compareAndSet(false,true))return;notice("Đang tải bản cập nhật…");io.execute(()->{File part=null;try{
  JSONObject meta;HttpURLConnection c=connect(UrlPolicy.ORIGIN+"/api/app-release");try{if(c.getResponseCode()!=200)throw new IOException("Chưa lấy được bản mới");try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>16000)throw new IOException("Thông tin bản mới không hợp lệ");}meta=new JSONObject(out.toString("UTF-8"));}}finally{c.disconnect();}
  if(!activity.getPackageName().equals(meta.getString("package_id"))||!"/downloads/WorkArea-Offline-1.0.0.apk".equals(meta.getString("url")))throw new IOException("Sai ứng dụng cập nhật");
  long expected=meta.getLong("version_code"),size=meta.getLong("bytes");String hash=meta.getString("sha256");if(expected<=code(activity.getPackageManager().getPackageInfo(activity.getPackageName(),0))){notice("Bạn đang dùng bản mới nhất.");return;}if(size<1||size>128L*1024*1024||!hash.matches("[0-9a-f]{64}"))throw new IOException("Thông tin tải không hợp lệ");
  File dir=new File(activity.getCacheDir(),"updates");if(!dir.exists()&&!dir.mkdirs())throw new IOException("Không tạo được nơi tải");part=new File(dir,"update-download.apk");MessageDigest digest=MessageDigest.getInstance("SHA-256");long total=0;
  c=connect(UrlPolicy.ORIGIN+meta.getString("url"));try{if(c.getResponseCode()!=200)throw new IOException("Không tải được APK");try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(part)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1){total+=n;if(total>size)throw new IOException("Dung lượng APK không khớp");out.write(b,0,n);digest.update(b,0,n);}}}finally{c.disconnect();}
  StringBuilder actual=new StringBuilder();for(byte b:digest.digest())actual.append(String.format(Locale.ROOT,"%02x",b&255));if(total!=size||!hash.equals(actual.toString()))throw new IOException("APK chưa tải đủ hoặc đã thay đổi. Hãy thử lại.");verify(part,expected);
  File apk=new File(dir,"WorkArea-update.apk");if(apk.exists()&&!apk.delete())throw new IOException("Không thay được APK cũ");if(!part.renameTo(apk))throw new IOException("Không hoàn tất được file tải");activity.runOnUiThread(()->{if(!closed){ready=apk;install();}});
 }catch(Exception e){if(part!=null)part.delete();notice("Chưa cập nhật: "+e.getMessage());}finally{busy.set(false);}});}
 private Set<String> signers(PackageInfo p)throws Exception{Signature[] ss=Build.VERSION.SDK_INT>=28?p.signingInfo.getApkContentsSigners():p.signatures;Set<String> r=new HashSet<>();for(Signature s:ss)r.add(android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(s.toByteArray()),android.util.Base64.NO_WRAP));return r;}
 private void verify(File f,long expected)throws Exception{int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;PackageInfo apk=activity.getPackageManager().getPackageArchiveInfo(f.getAbsolutePath(),flags),current=activity.getPackageManager().getPackageInfo(activity.getPackageName(),flags);if(apk==null||!current.packageName.equals(apk.packageName)||code(apk)!=expected||code(apk)<=code(current)||!signers(apk).equals(signers(current)))throw new IOException("APK không đúng ứng dụng, phiên bản hoặc chữ ký Work Area");}
 private void install(){if(ready==null||closed)return;try{
  if(!activity.getPackageManager().canRequestPackageInstalls()){waitingPermission=true;new AlertDialog.Builder(activity).setTitle("Cho phép cập nhật Work Area").setMessage("Bật quyền cài ứng dụng từ Work Area, rồi quay lại để cập nhật.").setNegativeButton("Để sau",(d,w)->waitingPermission=false).setPositiveButton("Mở cài đặt",(d,w)->activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())))).show();return;}
  Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".updates",ready);Intent i=new Intent(Intent.ACTION_VIEW);i.setDataAndType(uri,"application/vnd.android.package-archive");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.startActivity(i);ready=null;waitingPermission=false;
 }catch(Exception e){notice("Không mở được trình cài đặt Android: "+e.getMessage());}}
 void resume(){if(waitingPermission&&ready!=null&&activity.getPackageManager().canRequestPackageInstalls()){waitingPermission=false;install();}}
 void close(){closed=true;io.shutdown();}
}
