package vn.hansol.workarea.offline;
public class UrlPolicyTest {
 public static void main(String[] args){String[] allowed={"https://work-area.odermenu.duckdns.org/","https://work-area.odermenu.duckdns.org:443/api/me"};String[] denied={"http://work-area.odermenu.duckdns.org/","https://work-area.odermenu.duckdns.org.evil.example/","https://work-area.odermenu.duckdns.org@evil.example/","https://evil.example@work-area.odermenu.duckdns.org/","https://work-area.odermenu.duckdns.org:444/","file:///etc/passwd","javascript:alert(1)","data:text/html,test"};for(String url:allowed)if(!UrlPolicy.trusted(url))throw new AssertionError(url);for(String url:denied)if(UrlPolicy.trusted(url))throw new AssertionError(url);System.out.println("Android URL/camera/bridge origin policy PASS");}
}
