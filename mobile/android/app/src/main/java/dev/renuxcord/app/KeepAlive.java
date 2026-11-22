package dev.renuxcord.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps Discord connected while the app is in the background, so message notifications keep coming and a voice call
 * keeps its microphone. Android only allows that while the app shows an ongoing notification
 */
public class KeepAlive extends Service {
    private static final String CHANNEL = "connection";
    private static final int NOTIFICATION_ID = 0x5258;

    private static KeepAlive instance;
    private static boolean inCall = false;

    /** Starts, updates or stops the service to match the settings and whether a call is on */
    static void update(Context ctx) {
        boolean wanted = inCall || AppSettings.isStayConnectedEnabled(ctx);
        if (!wanted) {
            ctx.stopService(new Intent(ctx, KeepAlive.class));
            return;
        }
        if (instance != null) {
            instance.refresh();
            return;
        }
        try {
            ctx.startForegroundService(new Intent(ctx, KeepAlive.class));
        } catch (Exception e) {
            // Android 12+ won't start one from the background; it starts the next time the app is open
            Logger.w("Couldn't start the background connection", e);
        }
    }

    static void setInCall(Context ctx, boolean on) {
        if (inCall == on) return;
        inCall = on;
        update(ctx);
    }

    static void stop(Context ctx) {
        inCall = false;
        ctx.stopService(new Intent(ctx, KeepAlive.class));
    }

    static void createChannel(Context ctx) {
        var nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        var channel = new NotificationChannel(CHANNEL, ctx.getString(R.string.keepalive_channel), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(ctx.getString(R.string.keepalive_channel_description));
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        refresh();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void refresh() {
        createChannel(this);
        var open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(inCall ? R.string.keepalive_call : R.string.keepalive_connected))
                .setContentText(getString(inCall ? R.string.keepalive_call_text : R.string.keepalive_connected_text))
                .setColor(0xFFFF5A2C)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(open)
                .build();

        try {
            begin(notification, types(inCall));
        } catch (Exception e) {
            // Android 14+ refuses the call types in some states (the mic not granted yet, say): try without them
            Logger.w("Background connection refused the call types, trying without", e);
            try {
                begin(notification, types(false));
            } catch (Exception e2) {
                Logger.e("Couldn't keep Discord connected in the background", e2);
                stopSelf();
            }
        }
    }

    private void begin(Notification notification, int types) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, types);
        else startForeground(NOTIFICATION_ID, notification);
    }

    private int types(boolean call) {
        int types = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
        if (call && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        if (call && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        }
        return types;
    }
}
