package com.relaynative;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/** Channels + builders shared by the FCM service and the call service. */
public final class NotificationHelper {
    public static final String CHANNEL_ONGOING = "relay_ongoing_call";
    public static final String CHANNEL_RING = "relay_incoming_ring";
    public static final String CHANNEL_GENERAL = "relay_general";
    public static final int RING_NOTIF_ID = 42;
    public static final int GENERAL_NOTIF_ID = 43;

    private NotificationHelper() {}

    public static void ensureChannels(Context ctx) {
        // Channels exist only on API 26+; minSdk is 24 and NotificationCompat
        // works channel-less there — an unguarded NotificationChannel is a
        // NoClassDefFoundError process crash at app boot on Android 7.x.
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel ongoing = new NotificationChannel(
                CHANNEL_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription("Shown while a RELAY call is active");
        nm.createNotificationChannel(ongoing);

        NotificationChannel ring = new NotificationChannel(
                CHANNEL_RING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Rings when someone calls you on RELAY");
        ring.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build());
        ring.enableVibration(true);
        ring.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 400});
        nm.createNotificationChannel(ring);

        NotificationChannel general = new NotificationChannel(
                CHANNEL_GENERAL, "Missed calls & alerts", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(general);
    }

    /** Full-screen, lock-screen-capable incoming-call ring. */
    public static void showIncomingCall(Context ctx, String title, String body) {
        ensureChannels(ctx);
        Intent full = new Intent(ctx, IncomingCallActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("title", title)
                .putExtra("body", body);
        PendingIntent fullPi = PendingIntent.getActivity(ctx, 1, full,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent open = new Intent(ctx, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 2, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_RING)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setContentTitle(title != null ? title : "Incoming call")
                .setContentText(body != null ? body : "Someone is calling you on RELAY")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(openPi)
                .setAutoCancel(true)
                // The caller's ring window is ~65s — the stale ring self-clears.
                .setTimeoutAfter(65_000)
                .build();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(RING_NOTIF_ID, n);
    }

    public static void showGeneric(Context ctx, String title, String body) {
        ensureChannels(ctx);
        Intent open = new Intent(ctx, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 3, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_GENERAL)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setContentTitle(title != null ? title : "RELAY")
                .setContentText(body != null ? body : "")
                .setContentIntent(openPi)
                .setAutoCancel(true)
                .build();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(GENERAL_NOTIF_ID, n);
    }

    public static void cancelRing(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(RING_NOTIF_ID);
    }
}
