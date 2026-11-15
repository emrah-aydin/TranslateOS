// TranslateOS kurulum (Android) — ekran: assets/index.html (WebView); işler Installer.java'da.
// Copyright (C) 2026 Emrah AYDIN. AGPL-3.0.
package com.translateos.installer;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#070b12"));
        getWindow().setNavigationBarColor(Color.parseColor("#070b12"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#070b12"));
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setAllowFileAccess(false);
        web.addJavascriptInterface(new Bridge(), "TOS");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    private void js(final String code) { web.post(() -> web.evaluateJavascript(code, null)); }

    private void done(String cb, JSONObject result) { js("window.__tosCb(" + JSONObject.quote(cb) + "," + result + ")"); }

    class Bridge {
        @JavascriptInterface
        public void scan(final String cb) {
            new Thread(() -> {
                JSONObject r = new JSONObject();
                try { r.put("tvs", Installer.discover(MainActivity.this, 3000)); } catch (Exception ignored) { }
                done(cb, r);
            }).start();
        }

        @JavascriptInterface
        public void probe(final String cb, final String ip) {
            new Thread(() -> {
                JSONObject r;
                try { r = Installer.isIp(ip) ? Installer.probe(ip.trim()) : new JSONObject().put("error", "IP geçersiz"); }
                catch (Exception e) { r = new JSONObject(); }
                done(cb, r);
            }).start();
        }

        @JavascriptInterface
        public void install(final String cb, final String ip, final String code) {
            new Thread(() -> {
                JSONObject r = new JSONObject();
                try {
                    Installer.install(MainActivity.this, ip, code, (id, state, note) ->
                        js("window.__tosStep(" + JSONObject.quote(id) + "," + JSONObject.quote(state) + "," + (note == null ? "null" : JSONObject.quote(note)) + ")"));
                    r.put("ok", true);
                } catch (Installer.Friendly e) {
                    try { r.put("error", e.getMessage()); } catch (Exception ignored) { }
                } catch (Exception e) {
                    try { r.put("error", "Kurulum tamamlanamadı: " + e.getMessage()); } catch (Exception ignored) { }
                }
                done(cb, r);
            }).start();
        }
    }
}
