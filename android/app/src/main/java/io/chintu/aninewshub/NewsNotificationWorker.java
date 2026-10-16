package io.chintu.aninewshub;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class NewsNotificationWorker extends Worker {
    static final String INPUT_PRIME = "prime_snapshot";
    private static final String CHANNEL_ID = "new_stories";
    private static final String FEED_URL = "https://aninews-hub.pages.dev/data/articles.json";

    public NewsNotificationWorker(Context context, WorkerParameters params) {
        super(context, params);
    }

    @Override
    public Result doWork() {
        if (!NotificationScheduler.hasSubscription(getApplicationContext())
                || !NotificationScheduler.notificationsAllowed(getApplicationContext())) {
            return Result.success();
        }

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(FEED_URL).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "AniNews-Hub-Android/1.0");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return Result.retry();

            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream())) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            }

            JSONObject payload = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            JSONArray articles = payload.optJSONArray("articles");
            if (articles == null) return Result.retry();

            SharedPreferences prefs = NotificationScheduler.preferences(getApplicationContext());
            Set<String> previous = new HashSet<>(prefs.getStringSet(
                    NotificationScheduler.KEY_SEEN_IDS, Collections.emptySet()));
            Set<String> current = new HashSet<>();
            List<JSONObject> newlySeen = new ArrayList<>();
            for (int i = 0; i < articles.length(); i++) {
                JSONObject article = articles.optJSONObject(i);
                if (article == null) continue;
                String id = article.optString("id", "");
                if (id.isEmpty()) id = article.optString("link", "");
                if (id.isEmpty()) continue;
                current.add(id);
                if (!previous.contains(id)) newlySeen.add(article);
            }

            boolean prime = getInputData().getBoolean(INPUT_PRIME, false);
            if (!prime && !previous.isEmpty()) postSelectedNotifications(prefs, newlySeen);
            prefs.edit().putStringSet(NotificationScheduler.KEY_SEEN_IDS, current).apply();
            return Result.success();
        } catch (Exception exception) {
            return Result.retry();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void postSelectedNotifications(SharedPreferences prefs, List<JSONObject> fresh) {
        if (fresh.isEmpty()) return;
        boolean allSources = prefs.getBoolean(NotificationScheduler.KEY_ALL, false);
        Set<String> selected = new HashSet<>(prefs.getStringSet(
                NotificationScheduler.KEY_SOURCES, Collections.emptySet()));

        if (allSources) {
            postGroup("all", "AniNews Hub", fresh);
            return;
        }

        Map<String, List<JSONObject>> grouped = new HashMap<>();
        for (JSONObject article : fresh) {
            JSONObject source = article.optJSONObject("source");
            if (source == null) continue;
            String id = source.optString("id", "");
            if (!selected.contains(id)) continue;
            if (!grouped.containsKey(id)) grouped.put(id, new ArrayList<>());
            grouped.get(id).add(article);
        }

        for (Map.Entry<String, List<JSONObject>> entry : grouped.entrySet()) {
            String name = entry.getKey();
            for (SourceCatalog.Source source : SourceCatalog.SOURCES) {
                if (source.id.equals(entry.getKey())) {
                    name = source.name;
                    break;
                }
            }
            postGroup(entry.getKey(), name, entry.getValue());
        }
    }

    private void postGroup(String key, String sourceName, List<JSONObject> articles) {
        JSONObject newest = articles.get(0);
        String headline = newest.optString("translatedTitle", "");
        if (headline.isEmpty()) headline = newest.optString("title", "New story");
        String link = newest.optString("link", "https://aninews-hub.pages.dev/");
        String title = key.equals("all")
                ? (articles.size() == 1 ? "New AniNews Hub story" : articles.size() + " new AniNews Hub stories")
                : (articles.size() == 1 ? "New from " + sourceName : articles.size() + " new from " + sourceName);

        Intent openArticle = new Intent(getApplicationContext(), MainActivity.class)
                .putExtra(MainActivity.EXTRA_INITIAL_URL, link)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                getApplicationContext(), key.hashCode(), openArticle,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(headline)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(headline))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(getApplicationContext())
                    .notify(key.hashCode() & 0x7fffffff, notification.build());
        } catch (SecurityException ignored) {
            // The user may have revoked notification permission while a worker was running.
        }
    }

    static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "New stories", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("New articles from the publishers you follow");
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
