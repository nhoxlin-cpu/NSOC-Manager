package vn.hansol.workarea.offline;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
 private WebView web;
 private PhoneWatchBridge watchBridge;
 private AppUpdates appUpdates;
 private PermissionRequest cameraRequest;
 private ValueCallback<Uri[]> fileChooser;
 private final ExecutorService io=Executors.newSingleThreadExecutor();
 private volatile Download pendingDownload;
 private final Map<String,Export> exports=new ConcurrentHashMap<>();
 private static final int CAMERA=71,CHOOSE=72,SAVE=73;
 private static class Download {String name,mime,url,cookie;File localFile;}
 private static class Export {File file;FileOutputStream stream;String name,mime;}
 private void notice(String text){runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);getWindow().setStatusBarColor(Color.rgb(18,49,67));getWindow().setNavigationBarColor(Color.rgb(18,49,67));
  LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(18,49,67));
  root.setOnApplyWindowInsetsListener((view,insets)->{int left,top,right,bottom;if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());android.graphics.Insets keyboard=insets.getInsets(android.view.WindowInsets.Type.ime());left=bars.left;top=bars.top;right=bars.right;bottom=Math.max(bars.bottom,keyboard.bottom);}else{left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();}view.setPadding(left,top,right,bottom);return insets;});
  String savedOrigin=getPreferences(MODE_PRIVATE).getString("server",UrlPolicy.DEFAULT_ORIGIN);UrlPolicy.ORIGIN=UrlPolicy.allowedOrigin(savedOrigin)?savedOrigin:UrlPolicy.DEFAULT_ORIGIN;
  web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,-1));setContentView(root);root.requestApplyInsets();
  WebView.setWebContentsDebuggingEnabled(false);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setDatabaseEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(false);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setSafeBrowsingEnabled(true);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.addJavascriptInterface(new NativeFiles(),"WorkAreaNative");
  appUpdates=new AppUpdates(this,()->UrlPolicy.trusted(web.getUrl()));web.addJavascriptInterface(appUpdates,"WorkAreaUpdates");
  watchBridge=new PhoneWatchBridge(this,()->UrlPolicy.trusted(web.getUrl()));web.addJavascriptInterface(watchBridge,"WorkAreaWatch");
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    if(!UrlPolicy.trusted(request.getUrl().toString())||!"GET".equals(request.getMethod()))return null;
    String path=request.getUrl().getPath();if(path==null||path.startsWith("/api/")||path.startsWith("/downloads/"))return null;
    if(path.equals("/")||path.isEmpty())path="/index.html";if(path.contains("..")||path.contains("\\")||path.contains("\0"))return blocked();
    try{InputStream stream=getAssets().open("www"+path);String mime=path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".html")?"text/html":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".wasm")?"application/wasm":path.endsWith(".json")||path.endsWith(".webmanifest")?"application/json":"application/octet-stream";
     Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");headers.put("Content-Security-Policy","default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");return new WebResourceResponse(mime,mime.equals("application/wasm")?null:"UTF-8",200,"OK",headers,stream);
    }catch(Exception error){return blocked();}
   }
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){String url=request.getUrl().toString();if(UrlPolicy.trusted(url))return false;if("https".equals(request.getUrl().getScheme())||"http".equals(request.getUrl().getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));}catch(Exception ignored){}return true;}
   @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){if(!UrlPolicy.trusted(url)){result.cancel();return true;}new AlertDialog.Builder(MainActivity.this).setTitle("Xác nhận").setMessage(message).setPositiveButton("Đồng ý",(dialog,which)->result.confirm()).setNegativeButton("Quay lại",(dialog,which)->result.cancel()).setOnCancelListener(dialog->result.cancel()).show();return true;}
   @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{if(!UrlPolicy.trusted(request.getOrigin().toString())){request.deny();return;}boolean video=false;for(String resource:request.getResources())if(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource))video=true;if(!video){request.deny();return;}if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});else{if(cameraRequest!=null)cameraRequest.deny();cameraRequest=request;requestPermissions(new String[]{Manifest.permission.CAMERA},CAMERA);}});}
   @Override public void onPermissionRequestCanceled(PermissionRequest request){if(cameraRequest==request)cameraRequest=null;}
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(fileChooser!=null)fileChooser.onReceiveValue(null);fileChooser=callback;Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT);choose.addCategory(Intent.CATEGORY_OPENABLE);choose.setType("*/*");try{startActivityForResult(choose,CHOOSE);}catch(Exception error){fileChooser.onReceiveValue(null);fileChooser=null;}return true;}
  });
  web.setDownloadListener((url,agent,disposition,mime,length)->{if(!UrlPolicy.trusted(url)){notice("Chỉ tải file từ Work Area.");return;}Download d=new Download();d.url=url;d.cookie=CookieManager.getInstance().getCookie(url);d.mime=mime==null?"application/octet-stream":mime;d.name="WorkArea-download";if(disposition!=null){java.util.regex.Matcher m=java.util.regex.Pattern.compile("filename=\\\"?([^\\\";]+)").matcher(disposition);if(m.find())d.name=m.group(1);}chooseDestination(d);});
  web.loadUrl(UrlPolicy.ORIGIN+"/");
 }
 private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream("Not found".getBytes(java.nio.charset.StandardCharsets.UTF_8)));}
 private void chooseDestination(Download download){runOnUiThread(()->{if(pendingDownload!=null){if(download.localFile!=null)download.localFile.delete();notice("Hoàn tất hoặc hủy hộp thoại lưu file trước.");return;}pendingDownload=download;Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT);save.addCategory(Intent.CATEGORY_OPENABLE);save.setType(download.mime);save.putExtra(Intent.EXTRA_TITLE,download.name.replaceAll("[\\\\/:*?\"<>|]","_").substring(0,Math.min(download.name.length(),120)));try{startActivityForResult(save,SAVE);}catch(Exception error){pendingDownload=null;if(download.localFile!=null)download.localFile.delete();notice("Không mở được nơi lưu file.");}});}
 public class NativeFiles {
  @JavascriptInterface public void chooseServer(){runOnUiThread(()->{if(!UrlPolicy.trusted(web.getUrl()))return;String[] servers={UrlPolicy.DEFAULT_ORIGIN,UrlPolicy.ALTERNATE_ORIGIN};new AlertDialog.Builder(MainActivity.this).setTitle("Chọn server Work Area").setSingleChoiceItems(servers,UrlPolicy.ORIGIN.equals(servers[0])?0:1,(dialog,index)->{dialog.dismiss();if(servers[index].equals(UrlPolicy.ORIGIN))return;new AlertDialog.Builder(MainActivity.this).setTitle("Đổi server?").setMessage("Dữ liệu và đăng nhập được giữ riêng theo server. Hàng chờ cũ không chuyển sang server mới. Quay lại server cũ để đồng bộ các lượt còn chờ.").setPositiveButton("Đổi server",(d,w)->{getPreferences(MODE_PRIVATE).edit().putString("server",servers[index]).commit();recreate();}).setNegativeButton("Hủy",null).show();}).setNegativeButton("Đóng",null).show();});}
  @JavascriptInterface public synchronized String beginFile(String name,String mime){if(name==null||name.isEmpty()||name.length()>200||mime==null||mime.length()>200||pendingDownload!=null||!exports.isEmpty())return "";try{String id=UUID.randomUUID().toString();Export item=new Export();item.name=name;item.mime=mime;item.file=new File(getCacheDir(),"workarea-export-"+id);item.stream=new FileOutputStream(item.file);exports.put(id,item);return id;}catch(Exception error){return "";}}
  @JavascriptInterface public synchronized boolean appendFile(String id,String base64){Export item=exports.get(id);if(item==null||base64==null||base64.length()>100000)return false;try{item.stream.write(Base64.decode(base64,Base64.DEFAULT));return true;}catch(Exception error){abortFile(id);return false;}}
  @JavascriptInterface public synchronized void finishFile(String id){Export item=exports.remove(id);if(item==null)return;try{item.stream.close();Download download=new Download();download.name=item.name;download.mime=item.mime;download.localFile=item.file;runOnUiThread(()->{if(UrlPolicy.trusted(web.getUrl()))chooseDestination(download);else item.file.delete();});}catch(Exception error){item.file.delete();notice("Không chuẩn bị được file.");}}
  @JavascriptInterface public synchronized void abortFile(String id){Export item=exports.remove(id);if(item!=null){try{item.stream.close();}catch(Exception ignored){}item.file.delete();}}
 }
 @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==CAMERA&&cameraRequest!=null){if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)cameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});else cameraRequest.deny();cameraRequest=null;}}
 @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);if(code==CHOOSE){if(fileChooser!=null)fileChooser.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);fileChooser=null;return;}if(code!=SAVE)return;Download download=pendingDownload;pendingDownload=null;if(result!=RESULT_OK||data==null||download==null){if(download!=null&&download.localFile!=null)download.localFile.delete();return;}Uri destination=data.getData();io.execute(()->{try(OutputStream output=getContentResolver().openOutputStream(destination,"w")){if(output==null)throw new Exception("Không mở được nơi lưu");if(download.localFile!=null){try(InputStream input=new FileInputStream(download.localFile)){byte[] buffer=new byte[32768];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);}}else{HttpURLConnection connection=(HttpURLConnection)new URL(download.url).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(120000);if(download.cookie!=null)connection.setRequestProperty("Cookie",download.cookie);try{if(connection.getResponseCode()!=200)throw new Exception("Cần đăng nhập hoặc máy chủ chưa sẵn sàng");try(InputStream input=connection.getInputStream()){byte[] buffer=new byte[32768];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);}}finally{connection.disconnect();}}notice("Đã lưu "+download.name);}catch(Exception error){notice("Chưa lưu xong file: "+error.getMessage());}});}
 @Override public void onBackPressed(){web.evaluateJavascript("(()=>{const d=document.activeElement?.closest('dialog[open]')||[...document.querySelectorAll('dialog[open]')].pop();if(d){d.close();return true;}return false;})()",value->{if("true".equals(value))return;if(web.canGoBack())web.goBack();else finish();});}
 @Override protected void onResume(){super.onResume();if(appUpdates!=null)appUpdates.resume();}
 @Override protected void onDestroy(){if(appUpdates!=null)appUpdates.close();web.removeJavascriptInterface("WorkAreaUpdates");if(cameraRequest!=null)cameraRequest.deny();if(fileChooser!=null)fileChooser.onReceiveValue(null);for(Export item:exports.values()){try{item.stream.close();}catch(Exception ignored){}item.file.delete();}exports.clear();if(pendingDownload!=null&&pendingDownload.localFile!=null)pendingDownload.localFile.delete();web.removeJavascriptInterface("WorkAreaNative");web.removeJavascriptInterface("WorkAreaWatch");if(watchBridge!=null)watchBridge.close();web.destroy();io.shutdown();super.onDestroy();}
}
