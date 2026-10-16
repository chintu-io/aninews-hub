package io.chintu.aninewshub;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.HashSet;
import java.util.Set;

public class NotificationSettingsActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 401;

    private BrandTheme.Palette palette;
    private CheckBox allSources;
    private LinearLayout allCard;
    private final Set<String> selected = new HashSet<>();
    private final java.util.Map<String, CheckBox> sourceBoxes = new java.util.LinkedHashMap<>();
    private final java.util.Map<String, View> sourceCards = new java.util.LinkedHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean lightTheme = getIntent().getBooleanExtra(MainActivity.EXTRA_LIGHT_THEME, false);
        palette = new BrandTheme.Palette(lightTheme);
        getWindow().setStatusBarColor(palette.background);
        getWindow().setNavigationBarColor(palette.background);
        NotificationSettingsActivity.super.setTitle("Notifications");

        android.content.SharedPreferences prefs = NotificationScheduler.preferences(this);
        selected.addAll(prefs.getStringSet(NotificationScheduler.KEY_SOURCES, new HashSet<>()));
        boolean savedAll = prefs.getBoolean(NotificationScheduler.KEY_ALL, false);
        if (savedAll) {
            selected.clear();
            for (SourceCatalog.Source source : SourceCatalog.SOURCES) selected.add(source.id);
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(palette.background);

        LinearLayout brand = new LinearLayout(this);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        brand.setPadding(0, 0, 0, dp(14));
        TextView mark = new TextView(this);
        mark.setText("ア");
        mark.setTextColor(palette.background);
        mark.setTextSize(19);
        mark.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        mark.setRotation(-8f);
        mark.setGravity(Gravity.CENTER);
        GradientDrawable markBackground = new GradientDrawable();
        markBackground.setShape(GradientDrawable.OVAL);
        markBackground.setColor(palette.accent);
        mark.setBackground(markBackground);
        brand.addView(mark, new LinearLayout.LayoutParams(dp(40), dp(40)));
        TextView brandName = new TextView(this);
        SpannableString brandLabel = new SpannableString("AniNews Hub");
        brandLabel.setSpan(new ForegroundColorSpan(palette.accent), 8, 11,
                SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE);
        brandName.setText(brandLabel);
        brandName.setTextColor(palette.text);
        brandName.setTextSize(17);
        brandName.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        brandName.setPadding(dp(10), 0, 0, 0);
        brand.addView(brandName);
        root.addView(brand);

        TextView title = new TextView(this);
        title.setText("New story notifications");
        title.setTextColor(palette.text);
        title.setTextSize(25);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title, marginParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 8));

        TextView description = new TextView(this);
        description.setText("Choose all publishers or only the ones you follow. AniNews Hub checks for new stories in the background.");
        description.setTextColor(palette.muted);
        description.setTextSize(15);
        root.addView(description, marginParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 16));

        ScrollView scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);

        allSources = new CheckBox(this);
        allSources.setText("All sources");
        allSources.setTextColor(palette.text);
        allSources.setTextSize(17);
        allSources.setChecked(savedAll);
        BrandTheme.styleCheckBox(allSources, palette);
        allCard = cardWith(allSources, 58);
        list.addView(allCard, marginParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 16));

        TextView divider = new TextView(this);
        divider.setText("PUBLISHERS");
        divider.setTextColor(palette.accent);
        divider.setTextSize(12);
        divider.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        divider.setLetterSpacing(0.08f);
        divider.setPadding(dp(4), dp(2), 0, dp(8));
        list.addView(divider);

        for (SourceCatalog.Source source : SourceCatalog.SOURCES) {
            CheckBox box = new CheckBox(this);
            box.setText(source.name);
            box.setTextColor(palette.text);
            box.setTextSize(16);
            box.setChecked(savedAll || selected.contains(source.id));
            BrandTheme.styleCheckBox(box, palette);
            LinearLayout card = cardWith(box, 56);
            sourceBoxes.put(source.id, box);
            sourceCards.put(source.id, card);
            list.addView(card, marginParams(ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT, 0, 0, 0, 8));
            box.setOnCheckedChangeListener((button, checked) -> {
                if (checked) selected.add(source.id);
                else selected.remove(source.id);
                syncSelectionControls();
            });
            card.setOnClickListener(view -> box.setChecked(!box.isChecked()));
        }
        allSources.setOnCheckedChangeListener((button, checked) -> setAllChecked(checked));
        allCard.setOnClickListener(view -> allSources.setChecked(!allSources.isChecked()));
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        TextView cadence = new TextView(this);
        cadence.setText("Background checks run about every 30 minutes when Android allows them. Delivery can be delayed by battery and network restrictions.");
        cadence.setTextColor(palette.muted);
        cadence.setTextSize(13);
        cadence.setPadding(dp(12), dp(11), dp(12), dp(11));
        cadence.setBackground(BrandTheme.panel(false, 10, getResources().getDisplayMetrics().density, palette));
        root.addView(cadence, marginParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, 0, dp(10), 0, dp(10)));

        TextView save = new TextView(this);
        save.setText("Save preferences");
        BrandTheme.styleAction(save, true, getResources().getDisplayMetrics().density, palette);
        save.setOnClickListener(view -> savePreferences());
        root.addView(save, marginParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, 0, dp(2), 0, 0));

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(dp(20) + systemBars.left, dp(14) + systemBars.top,
                    dp(20) + systemBars.right, dp(16) + systemBars.bottom);
            return windowInsets;
        });
        setContentView(root);
        ViewCompat.requestApplyInsets(root);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setAppearanceLightStatusBars(lightTheme);
        bars.setAppearanceLightNavigationBars(lightTheme);
        syncSelectionControls();
    }

    private LinearLayout cardWith(CheckBox checkbox, int minHeightDp) {
        LinearLayout card = new LinearLayout(this);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(8), dp(2), dp(10), dp(2));
        card.setMinimumHeight(dp(minHeightDp));
        card.setBackground(BrandTheme.panel(checkbox.isChecked(), 12,
                getResources().getDisplayMetrics().density, palette));
        card.addView(checkbox, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return card;
    }

    private void syncSelectionControls() {
        boolean everySource = selected.size() == SourceCatalog.SOURCES.size();
        allSources.setOnCheckedChangeListener(null);
        allSources.setChecked(everySource);
        allSources.setOnCheckedChangeListener((button, checked) -> setAllChecked(checked));
        float density = getResources().getDisplayMetrics().density;
        allCard.setBackground(BrandTheme.panel(everySource, 12, density, palette));
        for (SourceCatalog.Source source : SourceCatalog.SOURCES) {
            View card = sourceCards.get(source.id);
            if (card != null) card.setBackground(BrandTheme.panel(selected.contains(source.id), 12, density, palette));
        }
    }

    private void setAllChecked(boolean checked) {
        selected.clear();
        if (checked) for (SourceCatalog.Source source : SourceCatalog.SOURCES) selected.add(source.id);
        for (SourceCatalog.Source source : SourceCatalog.SOURCES) {
            CheckBox box = sourceBoxes.get(source.id);
            if (box != null) box.setChecked(checked);
        }
        syncSelectionControls();
    }

    private void savePreferences() {
        boolean all = allSources.isChecked();
        if ((all || !selected.isEmpty()) && Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
            return;
        }
        finishSaving(all);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_NOTIFICATIONS) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) finishSaving(allSources.isChecked());
        else Toast.makeText(this, "Allow notifications in Android Settings to receive new-story alerts.", Toast.LENGTH_LONG).show();
    }

    private void finishSaving(boolean all) {
        NotificationScheduler.saveAndSchedule(this, all, selected);
        Toast.makeText(this, NotificationScheduler.hasSubscription(this)
                ? "Notification preferences saved"
                : "Notifications turned off", Toast.LENGTH_SHORT).show();
        finish();
    }

    private LinearLayout.LayoutParams marginParams(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(left, top, right, bottom);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
