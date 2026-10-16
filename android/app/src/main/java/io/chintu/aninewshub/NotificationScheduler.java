package io.chintu.aninewshub;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Data;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

public final class NotificationScheduler {
    public static final String PREFS = "aninews-notifications";
    public static final String KEY_ALL = "all_sources";
    public static final String KEY_SOURCES = "source_ids";
    static final String KEY_SEEN_IDS = "seen_article_ids";
    private static final String PERIODIC_NAME = "news-notification-poll";
    private static final String PRIME_NAME = "news-notification-prime";

    private NotificationScheduler() {}

    public static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean notificationsAllowed(Context context) {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    public static void saveAndSchedule(Context context, boolean allSources, Set<String> sourceIds) {
        Set<String> savedIds = new HashSet<>(sourceIds);
        preferences(context).edit()
                .putBoolean(KEY_ALL, allSources)
                .putStringSet(KEY_SOURCES, savedIds)
                .apply();

        WorkManager manager = WorkManager.getInstance(context);
        boolean hasSubscription = allSources || !savedIds.isEmpty();
        if (!hasSubscription || !notificationsAllowed(context)) {
            manager.cancelUniqueWork(PERIODIC_NAME);
            manager.cancelUniqueWork(PRIME_NAME);
            return;
        }

        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        OneTimeWorkRequest prime = new OneTimeWorkRequest.Builder(NewsNotificationWorker.class)
                .setInputData(new Data.Builder().putBoolean(NewsNotificationWorker.INPUT_PRIME, true).build())
                .setConstraints(constraints)
                .build();
        manager.enqueueUniqueWork(PRIME_NAME, ExistingWorkPolicy.REPLACE, prime);

        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(
                NewsNotificationWorker.class, 30, TimeUnit.MINUTES)
                .setInitialDelay(30, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
        manager.enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.REPLACE, periodic);
    }

    public static boolean hasSubscription(Context context) {
        SharedPreferences prefs = preferences(context);
        return prefs.getBoolean(KEY_ALL, false)
                || !prefs.getStringSet(KEY_SOURCES, new HashSet<>()).isEmpty();
    }
}
