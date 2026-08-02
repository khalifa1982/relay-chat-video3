/**
 * Expo config plugin: Native Android FCM data-push handling for RELAY incoming calls.
 *
 * This plugin generates native Kotlin files at prebuild time so that incoming
 * data-only FCM pushes (type: incoming_call / call_cancel) are handled NATIVELY
 * even when the app process is completely dead (swiped away / force-stopped).
 *
 * What it creates:
 *  1. RelayCallFcmService.kt — FirebaseMessagingService that:
 *     - Receives data-only HIGH-priority pushes
 *     - On incoming_call: shows a full-screen intent notification with ringtone,
 *       vibration, Answer/Decline actions, and 60s auto-timeout
 *     - On call_cancel: dismisses the notification and stops ringtone
 *  2. IncomingCallActivity.kt — Full-screen activity shown on lock screen with
 *     Answer/Decline buttons, ringtone loop, and auto-dismiss after 60s
 *  3. CallActionReceiver.kt — BroadcastReceiver for notification action buttons
 *  4. RelayNativeInterface.kt — @JavascriptInterface bound as "RelayNative" on
 *     the WebView for web→native messaging (webCallEnded, setAudioRoute)
 *  5. RelayAudioRouter.kt — AudioManager-based audio routing in MODE_IN_COMMUNICATION
 *  6. Manifest entries for the service, activity, and receiver
 *  7. Required permissions (VIBRATE, WAKE_LOCK, FOREGROUND_SERVICE_PHONE_CALL,
 *     BLUETOOTH_CONNECT)
 *  8. Copies ringtone.wav to android res/raw for notification channel sound
 *  9. Patches MainActivity.kt to attach RelayNativeInterface to the WebView
 */
const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PACKAGE = "com.app.relaymobile";

// ─── Kotlin source files ───────────────────────────────────────────────────

const RELAY_CALL_FCM_SERVICE = `package ${PACKAGE}

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class RelayCallFcmService : FirebaseMessagingService() {

    companion object {
        const val CHANNEL_ID = "incoming_calls"
        const val NOTIFICATION_ID = 7788
        const val ONGOING_CALL_NOTIFICATION_ID = 7789
        const val ACTION_ANSWER = "${PACKAGE}.ACTION_ANSWER"
        const val ACTION_DECLINE = "${PACKAGE}.ACTION_DECLINE"
        const val EXTRA_CALL_ID = "callId"
        const val EXTRA_ROOM_ID = "roomId"
        const val EXTRA_MODE = "mode"
        const val EXTRA_CALLER_NAME = "callerName"
        const val EXTRA_CALLER_AVATAR = "callerAvatar"
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val type = data["type"] ?: return

        when (type) {
            "incoming_call" -> handleIncomingCall(data)
            "call_cancel" -> handleCallCancel()
        }
    }

    override fun onNewToken(token: String) {
        // Token refresh is handled by the JS layer on next app open.
        // Store it in SharedPreferences so the WebView can pick it up.
        getSharedPreferences("relay_push", Context.MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token)
            .apply()
    }

    private fun handleIncomingCall(data: Map<String, String>) {
        val callId = data["callId"] ?: return
        val roomId = data["roomId"] ?: ""
        val mode = data["mode"] ?: "voice"
        val callerName = data["callerName"] ?: "Unknown"
        val callerAvatar = data["callerAvatar"] ?: ""

        // Wake the device
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(
            PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "relay:incoming_call"
        )
        wl.acquire(65000L) // 65s max

        createNotificationChannel()

        // Full-screen intent → IncomingCallActivity
        val fullScreenIntent = Intent(this, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_CALL_ID, callId)
            putExtra(EXTRA_ROOM_ID, roomId)
            putExtra(EXTRA_MODE, mode)
            putExtra(EXTRA_CALLER_NAME, callerName)
            putExtra(EXTRA_CALLER_AVATAR, callerAvatar)
        }
        val fullScreenPi = PendingIntent.getActivity(
            this, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Answer action
        val answerIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = ACTION_ANSWER
            putExtra(EXTRA_CALL_ID, callId)
            putExtra(EXTRA_ROOM_ID, roomId)
            putExtra(EXTRA_MODE, mode)
            putExtra(EXTRA_CALLER_NAME, callerName)
        }
        val answerPi = PendingIntent.getBroadcast(
            this, 1, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Decline action
        val declineIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = ACTION_DECLINE
            putExtra(EXTRA_CALL_ID, callId)
        }
        val declinePi = PendingIntent.getBroadcast(
            this, 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val ringtoneUri = Uri.parse("android.resource://\${packageName}/raw/ringtone")

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming RELAY Call")
            .setContentText("\${callerName} is calling\\u2026")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSound(ringtoneUri)
            .setVibrate(longArrayOf(0, 700, 700, 700, 700))
            .setFullScreenIntent(fullScreenPi, true)
            .addAction(android.R.drawable.ic_menu_call, "Answer", answerPi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi)
            .setTimeoutAfter(60000)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, notification)
    }

    private fun handleCallCancel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIFICATION_ID)

        // Also tell IncomingCallActivity to finish if it's showing
        val intent = Intent("${PACKAGE}.CALL_CANCEL")
        sendBroadcast(intent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ringtoneUri = Uri.parse("android.resource://\${packageName}/raw/ringtone")
            val audioAttr = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .build()

            val channel = NotificationChannel(
                CHANNEL_ID,
                "Incoming calls",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Full-screen incoming call notifications"
                setSound(ringtoneUri, audioAttr)
                vibrationPattern = longArrayOf(0, 700, 700, 700, 700)
                enableVibration(true)
                setBypassDnd(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }

            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }
}
`;

const INCOMING_CALL_ACTIVITY = `package ${PACKAGE}

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat

class IncomingCallActivity : AppCompatActivity() {

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private val timeoutRunnable = Runnable { declineCall() }

    private var callId: String = ""
    private var roomId: String = ""
    private var mode: String = "voice"
    private var callerName: String = "Unknown"

    private val cancelReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            stopRinging()
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            km.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Extract intent data
        callId = intent?.getStringExtra(RelayCallFcmService.EXTRA_CALL_ID) ?: ""
        roomId = intent?.getStringExtra(RelayCallFcmService.EXTRA_ROOM_ID) ?: ""
        mode = intent?.getStringExtra(RelayCallFcmService.EXTRA_MODE) ?: "voice"
        callerName = intent?.getStringExtra(RelayCallFcmService.EXTRA_CALLER_NAME) ?: "Unknown"

        // Simple UI
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(64, 200, 64, 64)
            setBackgroundColor(0xFF0B1020.toInt())
        }

        val title = TextView(this).apply {
            text = "Incoming RELAY Call"
            textSize = 24f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, 16)
        }
        layout.addView(title)

        val caller = TextView(this).apply {
            text = callerName
            textSize = 32f
            setTextColor(0xFF22D3EE.toInt())
            setPadding(0, 0, 0, 8)
        }
        layout.addView(caller)

        val modeText = TextView(this).apply {
            text = if (mode == "video") "Video Call" else "Voice Call"
            textSize = 16f
            setTextColor(0xFF8B93AD.toInt())
            setPadding(0, 0, 0, 80)
        }
        layout.addView(modeText)

        val btnLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 40, 0, 0)
        }

        val declineBtn = Button(this).apply {
            text = "Decline"
            setBackgroundColor(0xFFEF4444.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(48, 24, 48, 24)
            setOnClickListener { declineCall() }
        }
        val params = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        params.setMargins(0, 0, 16, 0)
        btnLayout.addView(declineBtn, params)

        val answerBtn = Button(this).apply {
            text = "Answer"
            setBackgroundColor(0xFF22C55E.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(48, 24, 48, 24)
            setOnClickListener { answerCall() }
        }
        val params2 = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        params2.setMargins(16, 0, 0, 0)
        btnLayout.addView(answerBtn, params2)

        layout.addView(btnLayout)
        setContentView(layout)

        // Start ringing
        startRinging()

        // Register cancel receiver
        val filter = IntentFilter("${PACKAGE}.CALL_CANCEL")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(cancelReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(cancelReceiver, filter)
        }

        // 60s auto-timeout
        handler.postDelayed(timeoutRunnable, 60000)
    }

    private fun startRinging() {
        try {
            val ringtoneUri = Uri.parse("android.resource://\${packageName}/raw/ringtone")
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .build()
                )
                setDataSource(this@IncomingCallActivity, ringtoneUri)
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            // Fallback to default ringtone
            try {
                val defaultUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                mediaPlayer = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .build()
                    )
                    setDataSource(this@IncomingCallActivity, defaultUri)
                    isLooping = true
                    prepare()
                    start()
                }
            } catch (_: Exception) {}
        }

        // Vibrate
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 700, 700, 700, 700)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(pattern, 0)
        }
    }

    private fun stopRinging() {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
        vibrator?.cancel()
        vibrator = null
        handler.removeCallbacks(timeoutRunnable)
    }

    private fun answerCall() {
        stopRinging()
        dismissNotification()

        // Launch MainActivity with deep link URL so Expo Linking can read it
        val uri = Uri.parse("relay://call?nativeCall=\${callId}&mode=\${mode}&action=answer")
        val launchIntent = Intent(Intent.ACTION_VIEW, uri).apply {
            setPackage(packageName)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        startActivity(launchIntent)
        finish()
    }

    private fun declineCall() {
        stopRinging()
        dismissNotification()

        // Launch MainActivity with deep link URL for decline
        val uri = Uri.parse("relay://call?nativeCall=\${callId}&mode=\${mode}&action=decline")
        val launchIntent = Intent(Intent.ACTION_VIEW, uri).apply {
            setPackage(packageName)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        startActivity(launchIntent)
        finish()
    }

    private fun dismissNotification() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.cancel(RelayCallFcmService.NOTIFICATION_ID)
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRinging()
        try { unregisterReceiver(cancelReceiver) } catch (_: Exception) {}
    }
}
`;

const CALL_ACTION_RECEIVER = `package ${PACKAGE}

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callId = intent.getStringExtra(RelayCallFcmService.EXTRA_CALL_ID) ?: ""
        val mode = intent.getStringExtra(RelayCallFcmService.EXTRA_MODE) ?: "voice"

        // Dismiss the notification
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(RelayCallFcmService.NOTIFICATION_ID)

        // Tell IncomingCallActivity to stop (if showing)
        context.sendBroadcast(Intent("${PACKAGE}.CALL_CANCEL"))

        when (intent.action) {
            RelayCallFcmService.ACTION_ANSWER -> {
                // Launch via deep link so Expo Linking can read the call params
                val uri = android.net.Uri.parse("relay://call?nativeCall=\${callId}&mode=\${mode}&action=answer")
                val launchIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage(context.packageName)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                context.startActivity(launchIntent)
            }
            RelayCallFcmService.ACTION_DECLINE -> {
                // Launch via deep link for decline
                val uri = android.net.Uri.parse("relay://call?nativeCall=\${callId}&mode=\${mode}&action=decline")
                val launchIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage(context.packageName)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                context.startActivity(launchIntent)
            }
        }
    }
}
`;

// ─── NEW: RelayAudioRouter.kt — Native AudioManager routing ────────────────

const RELAY_AUDIO_ROUTER = `package ${PACKAGE}

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView

/**
 * Manages audio routing for in-call WebView sessions.
 * Uses AudioManager in MODE_IN_COMMUNICATION for proper call audio.
 */
class RelayAudioRouter(private val context: Context) {

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val handler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var currentRoute: String = "speaker"
    private var isActive = false
    private var audioFocusRequest: android.media.AudioFocusRequest? = null

    // Receiver for audio route changes (headset plug/unplug, BT connect/disconnect)
    private val routeChangeReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            if (!isActive) return
            handler.postDelayed({
                val newRoute = detectCurrentRoute()
                if (newRoute != currentRoute) {
                    currentRoute = newRoute
                    notifyWebView(newRoute)
                }
            }, 300) // Small delay to let the system settle
        }
    }

    fun setWebView(wv: WebView?) {
        this.webView = wv
    }

    fun activate() {
        if (isActive) return
        isActive = true
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        // Request audio focus so other apps release the mic
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val focusReq = android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .build()
            audioManager.requestAudioFocus(focusReq)
            audioFocusRequest = focusReq
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        }

        // Register for route change events
        val filter = IntentFilter().apply {
            addAction(AudioManager.ACTION_HEADSET_PLUG)
            addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
            addAction(BluetoothAdapter.ACTION_CONNECTION_STATE_CHANGED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(routeChangeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(routeChangeReceiver, filter)
        }
    }

    fun deactivate() {
        if (!isActive) return
        isActive = false
        audioManager.mode = AudioManager.MODE_NORMAL
        audioManager.isSpeakerphoneOn = false
        if (audioManager.isBluetoothScoOn) {
            audioManager.isBluetoothScoOn = false
            audioManager.stopBluetoothSco()
        }
        // Abandon audio focus so other apps can use the mic again
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }
        try { context.unregisterReceiver(routeChangeReceiver) } catch (_: Exception) {}
    }

    /**
     * Set the audio route. Called from RelayNativeInterface when web sends setAudioRoute.
     */
    fun setRoute(route: String) {
        if (!isActive) {
            activate()
        }
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        when (route) {
            "speaker" -> {
                if (audioManager.isBluetoothScoOn) {
                    audioManager.isBluetoothScoOn = false
                    audioManager.stopBluetoothSco()
                }
                audioManager.isSpeakerphoneOn = true
            }
            "earpiece" -> {
                if (audioManager.isBluetoothScoOn) {
                    audioManager.isBluetoothScoOn = false
                    audioManager.stopBluetoothSco()
                }
                audioManager.isSpeakerphoneOn = false
            }
            "bluetooth" -> {
                audioManager.isSpeakerphoneOn = false
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
            }
        }
        currentRoute = route
        // Report back to web
        notifyWebView(route)
    }

    /**
     * Detect the current active audio route.
     */
    private fun detectCurrentRoute(): String {
        if (audioManager.isBluetoothScoOn) return "bluetooth"
        if (audioManager.isSpeakerphoneOn) return "speaker"

        // Check if wired headset is connected
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            for (device in devices) {
                if (device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                    device.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                    device.type == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    return "headphones"
                }
                if (device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                    return "bluetooth"
                }
            }
        }
        return "earpiece"
    }

    /**
     * Inject audioRouteChanged event into the WebView.
     */
    private fun notifyWebView(route: String) {
        val js = """
            (function() {
                try {
                    window.dispatchEvent(new CustomEvent('relay:native', {
                        detail: { type: 'audioRouteChanged', route: '$route' }
                    }));
                } catch(e) {}
            })();
        """.trimIndent()
        handler.post {
            webView?.evaluateJavascript(js, null)
        }
    }

    companion object {
        private const val TAG = "RelayAudioRouter"
    }
}
`;

// ─── NEW: RelayNativeInterface.kt — @JavascriptInterface for web→native ────

const RELAY_NATIVE_INTERFACE = `package ${PACKAGE}

import android.app.NotificationManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * Native JavaScript interface bound as "RelayNative" on the WebView.
 * The web app at your-chat.io calls:
 *   window.RelayNative.postMessage(JSON.stringify({type:'webCallEnded', callId:'...'}))
 *   window.RelayNative.postMessage(JSON.stringify({type:'setAudioRoute', route:'speaker'}))
 *
 * This runs on the WebView's JS thread — use Handler to post to main thread.
 */
class RelayNativeInterface(
    private val context: Context,
    private val audioRouter: RelayAudioRouter
) {
    private val handler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null

    fun setWebView(wv: WebView?) {
        this.webView = wv
        audioRouter.setWebView(wv)
    }

    @JavascriptInterface
    fun postMessage(jsonString: String) {
        try {
            val json = JSONObject(jsonString)
            val type = json.optString("type", "")
            when (type) {
                "webCallEnded", "callEnded" -> handleWebCallEnded(json)
                "setAudioRoute" -> handleSetAudioRoute(json)
                else -> Log.d(TAG, "Unknown message type: \$type")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing message: \$jsonString", e)
        }
    }

    private fun handleWebCallEnded(json: JSONObject) {
        val callId = json.optString("callId", "")
        Log.d(TAG, "webCallEnded: callId=\$callId")

        handler.post {
            // Dismiss any ongoing call notification
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(RelayCallFcmService.NOTIFICATION_ID)
            nm.cancel(RelayCallFcmService.ONGOING_CALL_NOTIFICATION_ID)

            // Deactivate audio routing
            audioRouter.deactivate()
        }
    }

    private fun handleSetAudioRoute(json: JSONObject) {
        val route = json.optString("route", "speaker")
        Log.d(TAG, "setAudioRoute: route=\$route")

        handler.post {
            audioRouter.setRoute(route)
        }
    }

    companion object {
        private const val TAG = "RelayNativeInterface"

        /**
         * Singleton instance so we can attach it from MainActivity and reference
         * it from the FCM service if needed.
         */
        @Volatile
        var instance: RelayNativeInterface? = null
    }
}
`;

// ─── NEW: RelayWebViewSetup.kt — Helper to attach interface to WebView ─────

const RELAY_WEBVIEW_SETUP = `package ${PACKAGE}

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView

/**
 * Finds the react-native-webview WebView in the view hierarchy and attaches
 * the RelayNative @JavascriptInterface to it.
 *
 * Called from MainActivity.onResume() with a short delay to ensure the RN
 * view tree is mounted.
 */
object RelayWebViewSetup {
    private const val TAG = "RelayWebViewSetup"
    private var attached = false

    @SuppressLint("SetJavaScriptEnabled")
    fun attachToWebView(activity: Activity) {
        if (attached) return
        val handler = Handler(Looper.getMainLooper())

        // Poll for WebView with increasing delays (RN mounts async)
        fun tryAttach(attempt: Int) {
            val webView = findWebView(activity.window.decorView)
            if (webView != null) {
                val audioRouter = RelayAudioRouter(activity)
                val nativeInterface = RelayNativeInterface(activity, audioRouter)
                nativeInterface.setWebView(webView)
                RelayNativeInterface.instance = nativeInterface

                webView.addJavascriptInterface(nativeInterface, "RelayNative")
                attached = true
                Log.d(TAG, "RelayNative interface attached to WebView")
            } else if (attempt < 10) {
                // Retry after delay (100ms, 200ms, 400ms, ...)
                handler.postDelayed({ tryAttach(attempt + 1) }, (100L * (attempt + 1)))
            } else {
                Log.w(TAG, "Could not find WebView after 10 attempts")
            }
        }

        handler.postDelayed({ tryAttach(0) }, 500)
    }

    fun detach() {
        attached = false
        RelayNativeInterface.instance?.setWebView(null)
        RelayNativeInterface.instance = null
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val found = findWebView(view.getChildAt(i))
                if (found != null) return found
            }
        }
        return null
    }
}
`;

// ─── Plugin implementation ─────────────────────────────────────────────────

function withAndroidFcmCall(config) {
  // Step 1: Modify AndroidManifest.xml
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return cfg;

    // Add FirebaseMessagingService
    application.service = application.service || [];
    const hasService = application.service.some(
      (s) => s.$?.["android:name"] === ".RelayCallFcmService"
    );
    if (!hasService) {
      application.service.push({
        $: {
          "android:name": ".RelayCallFcmService",
          "android:exported": "false",
          "android:directBootAware": "true",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }],
          },
        ],
      });
    }

    // Add IncomingCallActivity
    application.activity = application.activity || [];
    const hasActivity = application.activity.some(
      (a) => a.$?.["android:name"] === ".IncomingCallActivity"
    );
    if (!hasActivity) {
      application.activity.push({
        $: {
          "android:name": ".IncomingCallActivity",
          "android:exported": "false",
          "android:showWhenLocked": "true",
          "android:turnScreenOn": "true",
          "android:launchMode": "singleTop",
          "android:taskAffinity": "",
          "android:excludeFromRecents": "true",
          "android:theme": "@style/Theme.AppCompat.NoActionBar",
        },
      });
    }

    // Add CallActionReceiver
    application.receiver = application.receiver || [];
    const hasReceiver = application.receiver.some(
      (r) => r.$?.["android:name"] === ".CallActionReceiver"
    );
    if (!hasReceiver) {
      application.receiver.push({
        $: {
          "android:name": ".CallActionReceiver",
          "android:exported": "false",
        },
      });
    }

    // Add permissions
    addPermission(manifest, "android.permission.VIBRATE");
    addPermission(manifest, "android.permission.WAKE_LOCK");
    addPermission(manifest, "android.permission.FOREGROUND_SERVICE_PHONE_CALL");
    addPermission(manifest, "android.permission.USE_FULL_SCREEN_INTENT");
    addPermission(manifest, "android.permission.RECEIVE_BOOT_COMPLETED");
    addPermission(manifest, "android.permission.BLUETOOTH_CONNECT");
    addPermission(manifest, "android.permission.MODIFY_AUDIO_SETTINGS");

    return cfg;
  });

  // Step 2: Add firebase-messaging dependency to build.gradle
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidDir = path.join(projectRoot, "android");
      const buildGradlePath = path.join(androidDir, "app", "build.gradle");
      let buildGradle = fs.readFileSync(buildGradlePath, "utf8");

      // Add firebase-messaging dependency if not already present
      if (!buildGradle.includes("firebase-messaging")) {
        buildGradle = buildGradle.replace(
          /dependencies\s*\{/,
          `dependencies {\n    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))\n    implementation("com.google.firebase:firebase-messaging")`
        );
        fs.writeFileSync(buildGradlePath, buildGradle);
      }

      return cfg;
    },
  ]);

  // Step 3: Write Kotlin source files and copy ringtone to res/raw
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidDir = path.join(projectRoot, "android");
      const packageDir = path.join(
        androidDir,
        "app",
        "src",
        "main",
        "java",
        ...PACKAGE.split(".")
      );

      // Create package directory
      fs.mkdirSync(packageDir, { recursive: true });

      // Write Kotlin files
      fs.writeFileSync(
        path.join(packageDir, "RelayCallFcmService.kt"),
        RELAY_CALL_FCM_SERVICE
      );
      fs.writeFileSync(
        path.join(packageDir, "IncomingCallActivity.kt"),
        INCOMING_CALL_ACTIVITY
      );
      fs.writeFileSync(
        path.join(packageDir, "CallActionReceiver.kt"),
        CALL_ACTION_RECEIVER
      );
      fs.writeFileSync(
        path.join(packageDir, "RelayAudioRouter.kt"),
        RELAY_AUDIO_ROUTER
      );
      fs.writeFileSync(
        path.join(packageDir, "RelayNativeInterface.kt"),
        RELAY_NATIVE_INTERFACE
      );
      fs.writeFileSync(
        path.join(packageDir, "RelayWebViewSetup.kt"),
        RELAY_WEBVIEW_SETUP
      );

      // Copy ringtone to res/raw
      const resRawDir = path.join(androidDir, "app", "src", "main", "res", "raw");
      fs.mkdirSync(resRawDir, { recursive: true });
      const ringtoneSource = path.join(projectRoot, "assets", "audio", "ringtone.wav");
      const ringtoneDest = path.join(resRawDir, "ringtone.wav");
      if (fs.existsSync(ringtoneSource) && !fs.existsSync(ringtoneDest)) {
        fs.copyFileSync(ringtoneSource, ringtoneDest);
      }

      return cfg;
    },
  ]);

  // Step 4: Patch MainActivity to call RelayWebViewSetup.attachToWebView on resume
  config = withMainActivity(config, (cfg) => {
    let content = cfg.modResults.contents;

    // Add import if not present
    if (!content.includes("RelayWebViewSetup")) {
      // Add import after the last import statement
      content = content.replace(
        /(import [^\n]+\n)(?!import)/,
        `$1import ${PACKAGE}.RelayWebViewSetup\n`
      );

      // Add onResume override to call attachToWebView
      // Find the class body opening
      if (!content.includes("onResume")) {
        content = content.replace(
          /class MainActivity[^{]*\{/,
          `$&\n    override fun onResume() {\n        super.onResume()\n        RelayWebViewSetup.attachToWebView(this)\n    }\n`
        );
      }
    }

    cfg.modResults.contents = content;
    return cfg;
  });

  return config;
}

function addPermission(manifest, name) {
  manifest.manifest["uses-permission"] =
    manifest.manifest["uses-permission"] || [];
  const has = manifest.manifest["uses-permission"].some(
    (p) => p.$?.["android:name"] === name
  );
  if (!has) {
    manifest.manifest["uses-permission"].push({
      $: { "android:name": name },
    });
  }
}

module.exports = withAndroidFcmCall;
