package org.yourchat.relay;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Native call layer: OS speakerphone routing, ongoing-call foreground
        // service, ring channel + FCM token. Registered before the bridge boots.
        registerPlugin(CallAudioPlugin.class);
        registerPlugin(CallNativePlugin.class);
        super.onCreate(savedInstanceState);
        NotificationHelper.ensureChannels(this);
    }
}
