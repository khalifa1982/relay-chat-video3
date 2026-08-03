package org.yourchat.relay;

import android.app.Application;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * NATIVE-LAYER CRASH CAPTURE for the Android shell (v2.107.21).
 *
 * The web bundle inside this shell already reports its own JS crashes (the
 * reporter ships with the live site). What it can NEVER see is the shell
 * itself dying — an exception in CallService, the FCM service, a plugin, or
 * Capacitor's own Java layer kills the process before any JS runs. This class
 * closes that gap, delivering to the SAME https://your-chat.io/api/crash pipe
 * as every other surface, tagged platform "android-shell" so the admin crash
 * console tells the layers apart.
 *
 * THE FATAL PROBLEM, AND WHY PERSIST-THEN-SEND-NEXT-LAUNCH: at crash time the
 * process is milliseconds from death — a network call started here races
 * teardown and loses. So the handler only APPENDS one JSON line to a file in
 * filesDir (fast, reliably completes), and delivery happens on the NEXT app
 * start, from onCreate, on a background thread. Same contract as every RELAY
 * reporter: ANY http response counts as delivered (the server answers 204 to
 * everything on purpose), so nothing here can retry-loop; only a transport
 * failure keeps a line queued.
 *
 * THE PREVIOUS HANDLER IS CHAINED, NEVER REPLACED — Android's own crash
 * behaviour (the dialog, the process death, Play Console vitals) is exactly
 * what it was. This class only adds the record.
 *
 * An Application subclass rather than MainActivity because Application.onCreate
 * runs before ANY component — a crash in a service that starts with no activity
 * (an FCM push waking CallService) is still caught.
 */
public class RelayApplication extends Application {

    private static final String ENDPOINT = "https://your-chat.io/api/crash";
    private static final String PENDING_FILE = "relay_crash_pending.jsonl";
    /** Bounded like every RELAY crash queue — a boot-loop must not grow a file. */
    private static final int PENDING_MAX = 10;

    @Override
    public void onCreate() {
        super.onCreate();
        sendPendingReportsAsync();

        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                persistCrash(throwable);
            } catch (Throwable ignored) {
                // The recorder must never add a second failure to the first.
            }
            if (previous != null) previous.uncaughtException(thread, throwable);
        });
    }

    /** One JSON object per line (JSONL): appending a line cannot corrupt the
     *  lines already there, which matters when this runs mid-crash. */
    private void persistCrash(Throwable t) throws Exception {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));

        JSONObject o = new JSONObject();
        o.put("errorName", t.getClass().getSimpleName());
        o.put("errorMessage", t.getMessage() == null ? "" : t.getMessage());
        o.put("stack", sw.toString());
        o.put("at", System.currentTimeMillis());

        File f = new File(getFilesDir(), PENDING_FILE);
        JSONArray keep = readPending(f);
        keep.put(o);
        try (FileWriter w = new FileWriter(f, false)) {
            int start = Math.max(0, keep.length() - PENDING_MAX);
            for (int i = start; i < keep.length(); i++) {
                w.write(keep.getJSONObject(i).toString());
                w.write("\n");
            }
        }
    }

    private JSONArray readPending(File f) {
        JSONArray out = new JSONArray();
        if (!f.exists()) return out;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty()) out.put(new JSONObject(line));
            }
        } catch (Exception ignored) {
            // An unreadable queue is dropped — a report is not worth a boot loop.
        }
        return out;
    }

    /** Deliver whatever a previous (crashed) run persisted. Sequential on one
     *  background thread; stops at the first transport failure and keeps the
     *  remainder for the launch after that. */
    private void sendPendingReportsAsync() {
        new Thread(() -> {
            try {
                File f = new File(getFilesDir(), PENDING_FILE);
                JSONArray pending = readPending(f);
                if (pending.length() == 0) return;

                int delivered = 0;
                for (int i = 0; i < pending.length(); i++) {
                    if (!send(pending.getJSONObject(i))) break;
                    delivered++;
                }
                if (delivered >= pending.length()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                } else if (delivered > 0) {
                    try (FileWriter w = new FileWriter(f, false)) {
                        for (int i = delivered; i < pending.length(); i++) {
                            w.write(pending.getJSONObject(i).toString());
                            w.write("\n");
                        }
                    }
                }
            } catch (Throwable ignored) {
                // Best-effort by design.
            }
        }, "relay-crash-sender").start();
    }

    private boolean send(JSONObject crash) {
        try {
            JSONObject device = new JSONObject();
            device.put("os", "android");
            device.put("sdk", Build.VERSION.SDK_INT);
            device.put("model", Build.MODEL);
            device.put("brand", Build.BRAND);
            device.put("layer", "capacitor-shell");
            device.put("crashedAt", crash.optLong("at", 0));

            JSONObject body = new JSONObject();
            body.put("platform", "android-shell");
            body.put("appVersion", BuildConfig.VERSION_NAME);
            body.put("errorName", crash.optString("errorName", "Throwable"));
            body.put("errorMessage", crash.optString("errorMessage", ""));
            body.put("stack", crash.optString("stack", ""));
            body.put("device", device.toString());

            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            HttpURLConnection c = (HttpURLConnection) new URL(ENDPOINT).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) {
                os.write(payload);
            }
            c.getResponseCode(); // any response = delivered (server answers 204)
            c.disconnect();
            return true;
        } catch (Exception e) {
            return false; // offline — keep queued for the next launch
        }
    }
}
