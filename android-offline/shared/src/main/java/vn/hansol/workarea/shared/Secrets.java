package vn.hansol.workarea.shared;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class Secrets {
 private static final String ALIAS="workarea-watch-v1";
 private static synchronized SecretKey key() throws Exception {KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(!store.containsAlias(ALIAS)){KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();}return (SecretKey)store.getKey(ALIAS,null);}
 public static synchronized void put(Context context,String name,String value) throws Exception {Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());String encrypted=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);if(!context.getSharedPreferences("watch-secrets",0).edit().putString(name,encrypted).commit())throw new Exception("Cannot persist watch credentials");}
 public static synchronized String get(Context context,String name){try{String value=context.getSharedPreferences("watch-secrets",0).getString(name,null);if(value==null)return null;String[] parts=value.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}catch(Exception error){return null;}}
 public static synchronized void clear(Context c,String name){c.getSharedPreferences("watch-secrets",0).edit().remove(name).commit();}
 public static String hmac(String hexKey,String value) throws Exception {byte[] key=new byte[hexKey.length()/2];for(int i=0;i<key.length;i++)key[i]=(byte)Integer.parseInt(hexKey.substring(i*2,i*2+2),16);Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));StringBuilder out=new StringBuilder();for(byte b:mac.doFinal(value.getBytes(StandardCharsets.UTF_8)))out.append(String.format("%02x",b&255));return out.toString();}
 public static boolean verify(String key,String value,String signature){try{return signature!=null&&signature.matches("[a-f0-9]{64}")&&MessageDigest.isEqual(hmac(key,value).getBytes(StandardCharsets.US_ASCII),signature.getBytes(StandardCharsets.US_ASCII));}catch(Exception e){return false;}}
 private static SecretKey packetKey(String hex){byte[] raw=new byte[32];if(!hex.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid pair key");for(int i=0;i<raw.length;i++)raw[i]=(byte)Integer.parseInt(hex.substring(i*2,i*2+2),16);return new SecretKeySpec(raw,"AES");}
 public static String encryptPacket(String key,String body)throws Exception{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,packetKey(key));return java.util.Base64.getEncoder().encodeToString(cipher.getIV())+":"+java.util.Base64.getEncoder().encodeToString(cipher.doFinal(body.getBytes(StandardCharsets.UTF_8)));}
 public static String decryptPacket(String key,String value)throws Exception{if(value==null||value.length()>80000)throw new Exception("Packet too large");String[] parts=value.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,packetKey(key),new GCMParameterSpec(128,java.util.Base64.getDecoder().decode(parts[0])));return new String(cipher.doFinal(java.util.Base64.getDecoder().decode(parts[1])),StandardCharsets.UTF_8);}
}
