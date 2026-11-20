package vn.hansol.workarea.offline;
public class ServerChoiceTest {
 public static void main(String[] args){
  if(!UrlPolicy.ORIGIN.equals(UrlPolicy.DEFAULT_ORIGIN))throw new AssertionError("Default changed");
  if(UrlPolicy.trusted(UrlPolicy.ALTERNATE_ORIGIN))throw new AssertionError("Inactive server trusted");
  UrlPolicy.ORIGIN=UrlPolicy.ALTERNATE_ORIGIN;
  if(!UrlPolicy.trusted(UrlPolicy.ALTERNATE_ORIGIN+"/api/me"))throw new AssertionError("Alternate rejected");
  for(String url:new String[]{UrlPolicy.DEFAULT_ORIGIN,"http://workareahevh.duckdns.org","https://workareahevh.duckdns.org.evil.test","https://user@workareahevh.duckdns.org","https://workareahevh.duckdns.org:8443"})if(UrlPolicy.trusted(url))throw new AssertionError("Unsafe URL");
  if(UrlPolicy.allowedOrigin("https://evil.test"))throw new AssertionError("Unknown server");
  System.out.println("PASS selected-server origin isolation");
 }
}
