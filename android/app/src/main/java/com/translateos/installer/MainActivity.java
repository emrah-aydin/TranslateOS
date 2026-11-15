// TranslateOS kurulum (Android) — ekran: assets/index.html (WebView); işler Installer.java'da.
// Copyright (C) 2026 Emrah AYDIN. AGPL-3.0.
package com.translateos.installer;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView web;
    private View intro;
    private long introAt;

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
        web.setAlpha(0f);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String url) { hideIntro(); }
        });
        web.loadUrl("file:///android_asset/index.html");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#070b12"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        intro = buildIntro();
        root.addView(intro, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        introAt = SystemClock.uptimeMillis();
        // Logo hafifçe büyüyerek belirir
        View logo = intro.findViewWithTag("logo");
        logo.setScaleX(0.86f); logo.setScaleY(0.86f); logo.setAlpha(0f);
        logo.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(520).setInterpolator(new DecelerateInterpolator()).start();
    }

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    // Açılış: ortada logo, altında "TranslateOS" (OS açık mavi) ve "by Emrah AYDIN"
    private View buildIntro() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#070b12"));
        box.setClickable(true);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash_logo);
        logo.setTag("logo");
        box.addView(logo, new LinearLayout.LayoutParams(dp(140), dp(140)));

        TextView title = new TextView(this);
        SpannableString t = new SpannableString("TranslateOS");
        t.setSpan(new ForegroundColorSpan(Color.parseColor("#5ec8ff")), 9, 11, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        title.setText(t);
        title.setTextColor(Color.parseColor("#e9f2fb"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        title.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        title.setLetterSpacing(0.01f);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tp.topMargin = dp(18);
        box.addView(title, tp);

        TextView by = new TextView(this);
        by.setText("by Emrah AYDIN");
        by.setTextColor(Color.parseColor("#8fa3b8"));
        by.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(4);
        box.addView(by, bp);
        return box;
    }

    // Sayfa hazır olunca (en az 1,1 sn sonra) giriş ekranı yumuşakça kaybolur, kurulum ekranı belirir
    private void hideIntro() {
        if (intro == null) return;
        long wait = Math.max(0, 1100 - (SystemClock.uptimeMillis() - introAt));
        web.postDelayed(() -> {
            if (intro == null) return;
            final View v = intro; intro = null;
            web.animate().alpha(1f).setDuration(380).start();
            v.animate().alpha(0f).setDuration(380).withEndAction(() -> ((ViewGroup) v.getParent()).removeView(v)).start();
        }, wait);
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
