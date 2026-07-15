package com.relaynative;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * FCM entry point. The RELAY server sends DATA messages (never notification
 * payloads, so WE control presentation even when the app is dead):
 *   { kind: "incoming-call", title, body }  → full-screen lock-screen ring
 *   { kind: "missed-call",  title, body }   → normal notification
 */
public class RelayFcmService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        String kind = d.get("kind");
        String title = d.get("title");
        String body = d.get("body");
        if ("incoming-call".equals(kind)) {
            NotificationHelper.showIncomingCall(this, title, body);
        } else {
            NotificationHelper.showGeneric(this, title, body);
        }
    }

    @Override
    public void onNewToken(String token) {
        // Persisted so the JS layer can pick it up (and re-register with the
        // server) the next time the app opens.
        getSharedPreferences("relay", MODE_PRIVATE).edit().putString("fcm_token", token).apply();
    }
}
