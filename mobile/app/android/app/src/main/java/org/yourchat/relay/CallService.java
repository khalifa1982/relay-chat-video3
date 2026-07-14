package org.yourchat.relay;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Ongoing-call foreground service. Started by the web engine when a call
 * ESTABLISHES and stopped on hang-up: the persistent notification tells
 * Android a call is live so the process (and its WebRTC audio) is never
 * frozen in the background — the native fix for "backgrounded call dies".
 */
public class CallService extends Service {
    static final int NOTIF_ID = 41;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationHelper.ensureChannels(this);
        String title = intent != null ? intent.getStringExtra("title") : null;
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, NotificationHelper.CHANNEL_ONGOING)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setContentTitle(title != null ? title : "RELAY")
                .setContentText("Ongoing call — tap to return")
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(pi)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(NOTIF_ID, n,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                                | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            // Mic permission mid-revoked etc. — fall back to a plain foreground
            // start so the call notification still shows instead of crashing.
            try { startForeground(NOTIF_ID, n); } catch (Exception ignored) { /* best-effort */ }
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
