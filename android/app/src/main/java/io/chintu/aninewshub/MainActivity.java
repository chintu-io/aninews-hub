package io.chintu.aninewshub;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebResourceError;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;

public class MainActivity extends Activity {
    public static final String EXTRA_LIGHT_THEME = "light_theme";
    public static final String EXTRA_INITIAL_URL = "initial_url";
    private static final String PREF_LIGHT_THEME = "website_light_theme";
    private static final String PREF_LOCAL_STORAGE_MIGRATED = "live_site_storage_migrated";
    private static final String HOME_URL = "https://aninews-hub.pages.dev/";
    private static final String LOCAL_FALLBACK_URL =
            "https://appassets.androidplatform.net/assets/index.html";

    private WebView webView;
    private boolean loadingForMigration;
    private boolean fallbackAttempted;
    private Map<String, String> migratedLocalStorage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BrandTheme.BACKGROUND);
        getWindow().setNavigationBarColor(BrandTheme.BACKGROUND);
        NewsNotificationWorker.createNotificationChannel(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BrandTheme.BACKGROUND);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(16), dp(5), dp(12), dp(5));
        toolbar.setBackgroundColor(BrandTheme.BACKGROUND);
        View spacer = new View(this);
        toolbar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1));

        TextView notifications = new TextView(this);
        notifications.setText("Notifications");
        BrandTheme.styleAction(notifications, false, getResources().getDisplayMetrics().density);
        notifications.setOnClickListener(view -> openNotificationSettings());
        toolbar.addView(notifications, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                       WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && isLiveHome(request.getUrl().toString())
                        && !fallbackAttempted) {
                    fallbackAttempted = true;
                    loadingForMigration = false;
                    view.loadUrl(LOCAL_FALLBACK_URL);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (isAppHome(uri.toString())) return false;
                if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) {
                    openArticleFromHome(view, uri.toString());
                    return true;
                }
                openExternalScheme(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (loadingForMigration && isLocalFallback(url)) {
                    loadingForMigration = false;
                    view.evaluateJavascript("JSON.stringify(Object.entries(localStorage))", result -> {
                        migratedLocalStorage = readLocalStorage(result);
                        view.loadUrl(HOME_URL);
                    });
                    return;
                }
                if (isLiveHome(url) && migratedLocalStorage != null) {
                    applyLocalStorage(view);
                    return;
                }
                if (isAppHome(url)) rememberWebsiteTheme(view);
                rewriteBlankLinks(view);
            }
        });

        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, systemBars.top, 0, systemBars.bottom);
            return windowInsets;
        });
        setContentView(root);
        ViewCompat.requestApplyInsets(root);

        loadingForMigration = !getPreferences(MODE_PRIVATE)
                .getBoolean(PREF_LOCAL_STORAGE_MIGRATED, false);
        webView.loadUrl(loadingForMigration ? LOCAL_FALLBACK_URL : HOME_URL);
        String initialUrl = safeWebUrl(getIntent().getStringExtra(EXTRA_INITIAL_URL));
        if (initialUrl != null) webView.post(() -> openArticle(initialUrl,
                getPreferences(MODE_PRIVATE).getBoolean(PREF_LIGHT_THEME, false)));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String target = safeWebUrl(intent.getStringExtra(EXTRA_INITIAL_URL));
        if (target != null) openArticle(target,
                getPreferences(MODE_PRIVATE).getBoolean(PREF_LIGHT_THEME, false));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private void openNotificationSettings() {
        if (isAppHome(webView == null ? null : webView.getUrl())) {
            webView.evaluateJavascript("localStorage.getItem('aninews-theme') || 'dark'", value -> {
                boolean light = "\"light\"".equals(value);
                getPreferences(MODE_PRIVATE).edit().putBoolean(PREF_LIGHT_THEME, light).apply();
                launchNotificationSettings(light);
            });
            return;
        }
        boolean light = getPreferences(MODE_PRIVATE).getBoolean(PREF_LIGHT_THEME, false);
        launchNotificationSettings(light);
    }

    private void launchNotificationSettings(boolean light) {
        Intent intent = new Intent(this, NotificationSettingsActivity.class);
        intent.putExtra(EXTRA_LIGHT_THEME, light);
        startActivity(intent);
    }

    private void openArticleFromHome(WebView view, String url) {
        view.evaluateJavascript("localStorage.getItem('aninews-theme') || 'dark'", value -> {
            boolean light = "\"light\"".equals(value);
            getPreferences(MODE_PRIVATE).edit().putBoolean(PREF_LIGHT_THEME, light).apply();
            openArticle(url, light);
        });
    }

    private void openArticle(String url, boolean light) {
        Intent intent = new Intent(this, InAppBrowserActivity.class);
        intent.putExtra(InAppBrowserActivity.EXTRA_URL, url);
        intent.putExtra(EXTRA_LIGHT_THEME, light);
        startActivity(intent);
    }

    private void rememberWebsiteTheme(WebView view) {
        view.evaluateJavascript("localStorage.getItem('aninews-theme') || 'dark'", value ->
                getPreferences(MODE_PRIVATE).edit()
                        .putBoolean(PREF_LIGHT_THEME, "\"light\"".equals(value)).apply());
    }

    private void rewriteBlankLinks(WebView view) {
        view.evaluateJavascript("(function(){"
                + "function sameWindow(){document.querySelectorAll('a[target=_blank]').forEach(function(a){a.target='_self';});}"
                + "sameWindow();new MutationObserver(sameWindow).observe(document.documentElement,{childList:true,subtree:true});"
                + "})()", null);
    }

    private void openExternalScheme(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // Ignore links that have no installed handler.
        }
    }

    private boolean isAppHome(String url) {
        if (url == null) return false;
        return isLiveHome(url) || isLocalFallback(url);
    }

    private boolean isLiveHome(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equalsIgnoreCase(uri.getScheme())
                && "aninews-hub.pages.dev".equalsIgnoreCase(uri.getHost());
    }

    private boolean isLocalFallback(String url) {
        if (url == null) return false;
        return "appassets.androidplatform.net".equals(Uri.parse(url).getHost());
    }

    private Map<String, String> readLocalStorage(String result) {
        Map<String, String> values = new LinkedHashMap<>();
        try {
            JSONArray entries = new JSONArray(result);
            for (int index = 0; index < entries.length(); index++) {
                JSONArray entry = entries.getJSONArray(index);
                values.put(entry.getString(0), entry.getString(1));
            }
        } catch (Exception ignored) {
            // A missing or empty prior local store needs no migration.
        }
        return values;
    }

    private void applyLocalStorage(WebView view) {
        StringBuilder script = new StringBuilder("(function(){");
        for (Map.Entry<String, String> entry : migratedLocalStorage.entrySet()) {
            script.append("localStorage.setItem(")
                    .append(JSONObject.quote(entry.getKey())).append(",")
                    .append(JSONObject.quote(entry.getValue())).append(");");
        }
        script.append("return true;})()");
        view.evaluateJavascript(script.toString(), ignored -> {
            getPreferences(MODE_PRIVATE).edit()
                    .putBoolean(PREF_LOCAL_STORAGE_MIGRATED, true).apply();
            migratedLocalStorage = null;
            rememberWebsiteTheme(view);
            rewriteBlankLinks(view);
        });
    }

    private String safeWebUrl(String candidate) {
        if (candidate == null) return null;
        Uri uri = Uri.parse(candidate);
        String scheme = uri.getScheme();
        return uri.getHost() != null && ("http".equalsIgnoreCase(scheme)
                || "https".equalsIgnoreCase(scheme)) ? candidate : null;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
