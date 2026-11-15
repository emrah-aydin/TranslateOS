// TranslateOS kurulum (Android): TV'yi bulur, Developer Mode koduyla bağlanır, uygulamayı kurar ve açar.
// Copyright (C) 2026 Emrah AYDIN. AGPL-3.0.
package com.translateos.installer;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.KeyPair;
import com.jcraft.jsch.Session;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

class Installer {
    static final String APP_ID = "com.translateos.app";
    static final String REPO = "emrah-aydin/TranslateOS";
    static final String TV_TMP = "/media/developer/temp/translateos.ipk";
    static final String LUNA = "/usr/bin/luna-send-pub";

    interface Report { void step(String id, String state, String note); }

    static class Friendly extends Exception { Friendly(String m) { super(m); } }

    // ---------- yardımcılar ----------
    static byte[] httpGet(String url, int timeoutMs, int redirects) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(timeoutMs); c.setReadTimeout(timeoutMs);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("User-Agent", "TranslateOS-Installer-Android");
        int code = c.getResponseCode();
        if (code >= 300 && code < 400 && redirects > 0) {
            String loc = c.getHeaderField("Location"); c.disconnect();
            return httpGet(new URL(new URL(url), loc).toString(), timeoutMs, redirects - 1);
        }
        if (code != 200) { c.disconnect(); throw new Exception("HTTP " + code); }
        try (InputStream in = c.getInputStream()) { return readAll(in); } finally { c.disconnect(); }
    }

    static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int n;
        while ((n = in.read(b)) > 0) bo.write(b, 0, n);
        return bo.toByteArray();
    }

    static boolean portOpen(String host, int port, int timeoutMs) {
        try (Socket s = new Socket()) { s.connect(new InetSocketAddress(host, port), timeoutMs); return true; } catch (Exception e) { return false; }
    }

    static boolean isIp(String s) { return s != null && s.trim().matches("^(\\d{1,3})(\\.\\d{1,3}){3}$"); }

    // ---------- TV bulma (SSDP) ----------
    static JSONArray discover(Context ctx, int ms) {
        Map<String, String> found = new LinkedHashMap<>();
        WifiManager wifi = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = wifi != null ? wifi.createMulticastLock("translateos") : null;
        try {
            if (lock != null) { lock.setReferenceCounted(false); lock.acquire(); }
            MulticastSocket sock = new MulticastSocket(null);
            sock.setReuseAddress(true); sock.bind(new InetSocketAddress(0)); sock.setSoTimeout(400);
            byte[] msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n" +
                "ST: urn:lge-com:service:webos-second-screen:1\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
            InetAddress grp = InetAddress.getByName("239.255.255.250");
            long end = System.currentTimeMillis() + ms, nextSend = 0; int sent = 0;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < end) {
                if (sent < 3 && System.currentTimeMillis() >= nextSend) { sock.send(new DatagramPacket(msg, msg.length, grp, 1900)); sent++; nextSend = System.currentTimeMillis() + 500; }
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length); sock.receive(p);
                    String ip = p.getAddress().getHostAddress();
                    if (!found.containsKey(ip)) {
                        Matcher m = Pattern.compile("(?im)^location:\\s*(\\S+)").matcher(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                        found.put(ip, m.find() ? m.group(1) : null);
                    }
                } catch (SocketTimeoutException ignored) { }
            }
            sock.close();
        } catch (Exception ignored) {
        } finally { if (lock != null && lock.isHeld()) lock.release(); }
        JSONArray out = new JSONArray();
        for (Map.Entry<String, String> e : found.entrySet()) {
            try {
                String name = "LG TV";
                if (e.getValue() != null) {
                    try {
                        String xml = new String(httpGet(e.getValue(), 2000, 2), StandardCharsets.UTF_8);
                        Matcher m = Pattern.compile("<friendlyName>([^<]+)</friendlyName>").matcher(xml);
                        if (m.find()) name = m.group(1).replace("&amp;", "&").trim();
                    } catch (Exception ignored) { }
                }
                JSONObject o = probe(e.getKey()); o.put("name", name); out.put(o);
            } catch (Exception ignored) { }
        }
        return out;
    }

    static JSONObject probe(String ip) throws Exception {
        JSONObject o = new JSONObject();
        o.put("ip", ip); o.put("name", "LG TV");
        o.put("devMode", portOpen(ip, 9922, 1500));
        o.put("keyServer", portOpen(ip, 9991, 1500));
        return o;
    }

    // ---------- kurulum dosyası ----------
    static boolean looksLikeIpk(byte[] b) { return b != null && b.length > 10000 && new String(b, 0, 8, StandardCharsets.ISO_8859_1).equals("!<arch>\n"); }

    static byte[] getIpk(Context ctx, String[] version) throws Exception {
        try {
            JSONObject rel = new JSONObject(new String(httpGet("https://api.github.com/repos/" + REPO + "/releases/latest", 8000, 3), StandardCharsets.UTF_8));
            JSONArray assets = rel.getJSONArray("assets");
            for (int i = 0; i < assets.length(); i++) {
                JSONObject a = assets.getJSONObject(i);
                if (a.getString("name").endsWith(".ipk")) {
                    byte[] b = httpGet(a.getString("browser_download_url"), 30000, 5);
                    if (looksLikeIpk(b)) { version[0] = rel.optString("tag_name", ""); return b; }
                }
            }
        } catch (Exception ignored) { }
        try (InputStream in = ctx.getAssets().open("app.ipk")) {   // internet yoksa uygulamanın içindeki sürüm
            byte[] b = readAll(in);
            if (looksLikeIpk(b)) { version[0] = "uygulama içi"; return b; }
        } catch (Exception ignored) { }
        throw new Friendly("Kurulum dosyası indirilemedi. İnternet bağlantını kontrol edip tekrar dene.");
    }

    // ---------- SSH ----------
    static String exec(Session s, String cmd, byte[] stdin, int timeoutMs, LineHandler onLine) throws Exception {
        ChannelExec ch = (ChannelExec) s.openChannel("exec");
        ch.setCommand(cmd);
        InputStream in = ch.getInputStream();
        OutputStream out = ch.getOutputStream();
        ch.connect(10000);
        if (stdin != null) { out.write(stdin); out.flush(); }
        out.close();
        StringBuilder all = new StringBuilder(), line = new StringBuilder();
        long end = System.currentTimeMillis() + timeoutMs; byte[] b = new byte[4096];
        try {
            while (true) {
                while (in.available() > 0) {
                    int n = in.read(b); if (n < 0) break;
                    String t = new String(b, 0, n, StandardCharsets.UTF_8); all.append(t);
                    for (char c : t.toCharArray()) {
                        if (c == '\n') { String l = line.toString().trim(); line.setLength(0); if (onLine != null && !l.isEmpty() && onLine.handle(l)) return all.toString(); }
                        else line.append(c);
                    }
                }
                if (ch.isClosed()) { if (in.available() > 0) continue; break; }
                if (System.currentTimeMillis() > end) throw new Friendly("TV yanıt vermedi (zaman aşımı).");
                Thread.sleep(80);
            }
        } finally { ch.disconnect(); }
        return all.toString();
    }
    interface LineHandler { boolean handle(String line) throws Exception; }

    // ---------- kurulum adımları ----------
    static void install(Context ctx, String ip, String code, Report r) throws Exception {
        ip = ip == null ? "" : ip.trim(); code = code == null ? "" : code.trim();
        if (!isIp(ip)) throw new Friendly("TV'nin IP adresi geçersiz (örnek: 192.168.1.50).");
        if (!code.matches("^[A-Za-z0-9]{6}$")) throw new Friendly("Kod 6 karakter olmalı (harf ve rakam).");

        r.step("file", "run", null);
        String[] ver = { "" };
        byte[] ipk = getIpk(ctx, ver);
        r.step("file", "ok", ver[0]);

        r.step("connect", "run", null);
        if (!portOpen(ip, 9922, 3000)) {
            if (portOpen(ip, 3001, 2000)) throw new Friendly("Bu TV'de Developer Mode kapalı görünüyor (" + ip + "). Developer Mode uygulamasında \"Dev Mode Status\" ON olmalı.");
            throw new Friendly(ip + " adresinde TV'ye ulaşılamadı. TV açık mı, telefon ile aynı Wi-Fi ağında mı? IP adresini Developer Mode uygulamasından kontrol et.");
        }
        byte[] key;
        try { key = httpGet("http://" + ip + ":9991/webos_rsa", 6000, 0); }
        catch (Exception e) { throw new Friendly("TV'den bağlantı anahtarı alınamadı. Developer Mode uygulamasında \"Key Server\"ı ON yap ve tekrar dene."); }

        JSch jsch = new JSch();
        String pass = null;
        for (String c : new String[] { code, code.toUpperCase() }) {
            try { KeyPair kp = KeyPair.load(jsch, key, null); if (kp.decrypt(c)) { pass = c; kp.dispose(); break; } kp.dispose(); } catch (Exception ignored) { }
        }
        if (pass == null) throw new Friendly("Kod yanlış. TV'deki Developer Mode uygulamasında yazan Passphrase'i (6 karakter) kontrol et.");
        jsch.addIdentity("tv", key, null, pass.getBytes(StandardCharsets.UTF_8));
        Session s = jsch.getSession("prisoner", ip, 9922);
        s.setConfig("StrictHostKeyChecking", "no");
        s.setConfig("server_host_key", s.getConfig("server_host_key") + ",ssh-rsa");
        s.setConfig("PubkeyAcceptedAlgorithms", s.getConfig("PubkeyAcceptedAlgorithms") + ",ssh-rsa");
        try { s.connect(20000); }
        catch (Exception e) { throw new Friendly("TV bağlantıyı kabul etmedi. Developer Mode uygulamasında Key Server'ı kapatıp açtıktan sonra tekrar dene."); }
        r.step("connect", "ok", null);

        try {
            r.step("upload", "run", null);
            exec(s, "cat > '" + TV_TMP + "'", ipk, 120000, null);
            r.step("upload", "ok", (ipk.length / 1024) + " KB");

            r.step("install", "run", null);
            String param = new JSONObject().put("id", APP_ID).put("ipkUrl", TV_TMP).put("subscribe", true).toString();
            final String[] err = { null };
            exec(s, LUNA + " -i 'luna://com.webos.appInstallService/dev/install' '" + param + "'", null, 180000, line -> {
                int i = line.indexOf('{'); if (i < 0) return false;
                JSONObject o; try { o = new JSONObject(line.substring(i)); } catch (Exception e) { return false; }
                JSONObject d = o.optJSONObject("details");
                String state = d != null ? d.optString("state", "") : "";
                if (!o.optBoolean("returnValue", true)) { err[0] = "TV kurulumu reddetti: " + o.optString("errorText", o.optString("errorCode", "bilinmeyen hata")); return true; }
                if (state.toUpperCase().contains("FAILED")) { err[0] = "TV kurulumu reddetti: " + (d.optString("reason", state)); return true; }
                return state.toLowerCase().contains("installed") || state.toUpperCase().startsWith("SUCCESS");
            });
            if (err[0] != null) throw new Friendly(err[0]);
            r.step("install", "ok", null);
            try { exec(s, "rm -f '" + TV_TMP + "'", null, 15000, null); } catch (Exception ignored) { }

            r.step("launch", "run", null);
            exec(s, LUNA + " -n 1 'luna://com.webos.applicationManager/launch' '{\"id\":\"" + APP_ID + "\"}'", null, 20000, null);
            r.step("launch", "ok", null);
        } finally { s.disconnect(); }
    }
}
