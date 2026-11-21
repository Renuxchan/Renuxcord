package dev.renuxcord.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import java.net.HttpURLConnection;
import java.net.URL;

/** Discord's message notifications (the page's Notification API) as real Android notifications */
final class Notifier {
    private static final String CHANNEL = "messages";

    static void createChannel(Context ctx) {
        var nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;

        var channel = new NotificationChannel(CHANNEL, ctx.getString(R.string.notification_channel), NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(ctx.getString(R.string.notification_channel_description));
        nm.createNotificationChannel(channel);
    }

    static boolean enabled(Context ctx) {
        var nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    static void show(Context ctx, int id, String title, String body, String iconUrl) {
        var app = ctx.getApplicationContext();
        // Off the page's thread: the avatar is downloaded first
        new Thread(() -> {
            var nm = app.getSystemService(NotificationManager.class);
            if (nm == null || !nm.areNotificationsEnabled()) return;

            var open = new Intent(app, MainActivity.class)
                    .putExtra(MainActivity.EXTRA_NOTIFICATION, id)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            var tap = PendingIntent.getActivity(app, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            var builder = new Notification.Builder(app, CHANNEL)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setColor(0xFFFF5A2C)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setCategory(Notification.CATEGORY_MESSAGE)
                    .setAutoCancel(true)
                    .setContentIntent(tap);

            var avatar = download(iconUrl);
            if (avatar != null) builder.setLargeIcon(avatar);

            try {
                nm.notify(id, builder.build());
            } catch (SecurityException ex) {
                Logger.w("Not allowed to post notifications: " + ex);
            }
        }, "renuxcord-notification").start();
    }

    static void cancel(Context ctx, int id) {
        var nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(id);
    }

    // Only Discord's own image servers: the page names the URL
    private static Bitmap download(String url) {
        if (url == null || url.isEmpty()) return null;
        var uri = Uri.parse(url);
        var host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null
                || !(host.equals("cdn.discordapp.com") || host.equals("media.discordapp.net") || host.endsWith(".discord.com") || host.equals("discord.com")))
            return null;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            try (var is = conn.getInputStream()) {
                return BitmapFactory.decodeStream(is);
            }
        } catch (Exception ex) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
