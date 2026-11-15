package vn.hansol.workarea.offline;
import java.net.URI;
public final class UrlPolicy {
 public static final String ORIGIN="https://work-area.odermenu.duckdns.org";
 public static boolean trusted(String value){try{URI uri=new URI(value);return "https".equalsIgnoreCase(uri.getScheme())&&"work-area.odermenu.duckdns.org".equalsIgnoreCase(uri.getHost())&&uri.getUserInfo()==null&&(uri.getPort()==-1||uri.getPort()==443);}catch(Exception error){return false;}}
 private UrlPolicy(){}
}
