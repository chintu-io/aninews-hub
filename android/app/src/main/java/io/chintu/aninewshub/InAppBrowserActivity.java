package io.chintu.aninewshub;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class InAppBrowserActivity extends Activity {
    public static final String EXTRA_URL = "article_url";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean lightTheme = getIntent().getBooleanExtra(MainActivity.EXTRA_LIGHT_THEME, false);
        BrandTheme.Palette palette = new BrandTheme.Palette(lightTheme);
        getWindow().setStatusBarColor(palette.background);
        getWindow().setNavigationBarColor(palette.background);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(palette.background);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(16), dp(5), dp(16), dp(5));
        toolbar.setBackgroundColor(palette.background);

        TextView back = new TextView(this);
        back.setText("‹ Feed");
        BrandTheme.styleAction(back, false, getResources().getDisplayMetrics().density, palette);
        back.setOnClickListener(view -> finish());
        toolbar.addView(back, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView pageLabel = new TextView(this);
        pageLabel.setText("Article");
        pageLabel.setTextColor(palette.muted);
        pageLabel.setTextSize(14);
        pageLabel.setSingleLine(true);
        pageLabel.setPadding(dp(12), 0, 0, 0);
        toolbar.addView(pageLabel, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) return false;
                openExternalScheme(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                String host = Uri.parse(url).getHost();
                pageLabel.setText(host == null ? "Article" : host);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript("(function(){"
                        + "function sameWindow(){document.querySelectorAll('a[target=_blank]').forEach(function(a){a.target='_self';});}"
                        + "sameWindow();new MutationObserver(sameWindow).observe(document.documentElement,{childList:true,subtree:true});"
                        + "})()", null);
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(0, systemBars.top, 0, systemBars.bottom);
            return insets;
        });
        setContentView(root);
        ViewCompat.requestApplyInsets(root);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setAppearanceLightStatusBars(lightTheme);
        bars.setAppearanceLightNavigationBars(lightTheme);

        String url = safeWebUrl(getIntent().getStringExtra(EXTRA_URL));
        if (url == null) {
            finish();
            return;
        }
        webView.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        goBackOrClose();
    }

    private void goBackOrClose() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
    }

    private void openExternalScheme(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // Ignore links that have no installed handler.
        }
    }

    private String safeWebUrl(String candidate) {
        if (candidate == null) return null;
        Uri uri = Uri.parse(candidate);
        String scheme = uri.getScheme();
        return uri.getHost() != null && ("https".equalsIgnoreCase(scheme)
                || "http".equalsIgnoreCase(scheme)) ? candidate : null;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
