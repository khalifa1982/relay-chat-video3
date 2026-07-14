package org.yourchat.relay;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * OS-level call audio routing. This replaces the WebAudio "loudspeaker force"
 * the web engine uses in plain browsers: real AudioManager communication-mode
 * routing (earpiece <-> speakerphone; a connected headset/Bluetooth device
 * keeps priority exactly like the system dialer).
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {

    private AudioManager am() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /** Enter/leave communication audio mode for the duration of a call. */
    @PluginMethod
    public void setInCall(PluginCall call) {
        try {
            boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
            AudioManager am = am();
            if (active) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            } else {
                if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
                else am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("setInCall failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        try {
            boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
            AudioManager am = am();
            if (am.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }
            if (Build.VERSION.SDK_INT >= 31) {
                if (on) {
                    AudioDeviceInfo speaker = null;
                    for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { speaker = d; break; }
                    }
                    if (speaker != null) am.setCommunicationDevice(speaker);
                } else {
                    am.clearCommunicationDevice();
                }
            } else {
                am.setSpeakerphoneOn(on);
            }
            JSObject ret = new JSObject();
            ret.put("on", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("setSpeaker failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isSpeakerOn(PluginCall call) {
        try {
            AudioManager am = am();
            boolean on;
            if (Build.VERSION.SDK_INT >= 31) {
                AudioDeviceInfo d = am.getCommunicationDevice();
                on = d != null && d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
            } else {
                on = am.isSpeakerphoneOn();
            }
            JSObject ret = new JSObject();
            ret.put("on", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("isSpeakerOn failed: " + e.getMessage());
        }
    }
}
