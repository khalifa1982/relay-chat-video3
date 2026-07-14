package org.yourchat.relay;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Native call-lifecycle glue for the web engine:
 *  - ongoing-call FOREGROUND SERVICE (Android never freezes a live call)
 *  - POST_NOTIFICATIONS runtime permission (Android 13+)
 *  - the FCM device token (null until google-services.json is configured)
 */
@CapacitorPlugin(name = "CallNative")
public class CallNativePlugin extends Plugin {

    @Override
    public void load() {
        NotificationHelper.ensureChannels(getContext());
    }

    @PluginMethod
    public void startCallService(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), CallService.class);
            String title = call.getString("title");
            if (title != null) i.putExtra("title", title);
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("startCallService failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopCallService(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), CallService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject("stopCallService failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void ensureNotificationPermission(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= 33) {
            granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
            if (!granted && getActivity() != null) {
                ActivityCompat.requestPermissions(getActivity(),
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9911);
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPushToken(PluginCall call) {
        try {
            if (FirebaseApp.getApps(getContext()).isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("token", (String) null);
                ret.put("reason", "firebase-not-configured");
                call.resolve(ret);
                return;
            }
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                JSObject ret = new JSObject();
                ret.put("token", task.isSuccessful() ? task.getResult() : null);
                call.resolve(ret);
            });
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("token", (String) null);
            ret.put("reason", String.valueOf(e.getMessage()));
            call.resolve(ret);
        }
    }
}
