package vn.hansol.workarea.offline;
import java.net.URI;
public final class UrlPolicy {
 public static final String DEFAULT_ORIGIN="https://work-area.odermenu.duckdns.org";
 public static final String ALTERNATE_ORIGIN="https://workareahevh.duckdns.org";
 public static volatile String ORIGIN=DEFAULT_ORIGIN;
 public static boolean allowedOrigin(String value){return DEFAULT_ORIGIN.equals(value)||ALTERNATE_ORIGIN.equals(value);}
 public static boolean trusted(String value){try{URI uri=new URI(value);return "https".equalsIgnoreCase(uri.getScheme())&&new URI(ORIGIN).getHost().equalsIgnoreCase(uri.getHost())&&uri.getUserInfo()==null&&(uri.getPort()==-1||uri.getPort()==443);}catch(Exception error){return false;}}
 private UrlPolicy(){}
}
