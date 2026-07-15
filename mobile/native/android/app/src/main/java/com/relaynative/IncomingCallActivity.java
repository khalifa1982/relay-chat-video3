package com.relaynative;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen incoming-call screen (fired by the FCM ring's fullScreenIntent —
 * shows over the lock screen with the screen off). ANSWER opens the app: the
 * call engine registers with the signaling server, which redelivers the held
 * ring (deliverPendingRing), and the in-app answer flow takes over. DECLINE
 * just dismisses — the caller's no-answer window handles the rest honestly.
 * UI is built in code (dark RELAY palette) to keep the native layer tiny.
 */
public class IncomingCallActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0A0D10"));
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        TextView heading = new TextView(this);
        heading.setText(title != null ? title : "Incoming call");
        heading.setTextColor(Color.WHITE);
        heading.setTextSize(28);
        heading.setTypeface(Typeface.DEFAULT_BOLD);
        heading.setGravity(Gravity.CENTER);
        root.addView(heading);

        TextView sub = new TextView(this);
        sub.setText(body != null ? body : "RELAY");
        sub.setTextColor(Color.parseColor("#9AA4AE"));
        sub.setTextSize(16);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, pad / 3, 0, pad * 2);
        root.addView(sub);

        Button answer = new Button(this);
        answer.setText("Answer");
        answer.setTextColor(Color.WHITE);
        answer.setTextSize(18);
        answer.setBackgroundColor(Color.parseColor("#06D6A0"));
        answer.setOnClickListener(v -> {
            NotificationHelper.cancelRing(this);
            Intent open = new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(open);
            finish();
        });
        root.addView(answer, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, (int) (56 * getResources().getDisplayMetrics().density)));

        android.widget.Space gap = new android.widget.Space(this);
        root.addView(gap, new LinearLayout.LayoutParams(1, pad / 2));

        Button decline = new Button(this);
        decline.setText("Decline");
        decline.setTextColor(Color.WHITE);
        decline.setTextSize(18);
        decline.setBackgroundColor(Color.parseColor("#FF3B5C"));
        decline.setOnClickListener(v -> {
            NotificationHelper.cancelRing(this);
            finish();
        });
        root.addView(decline, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, (int) (56 * getResources().getDisplayMetrics().density)));

        setContentView(root);
    }
}
