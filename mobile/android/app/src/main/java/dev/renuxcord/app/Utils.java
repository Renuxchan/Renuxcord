package dev.renuxcord.app;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

public final class Utils {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    static boolean isDiscordUrl(Uri url) {
        if (url == null || !("https".equals(url.getScheme()) || "http".equals(url.getScheme()))) return false;
        var authority = url.getAuthority();
        if (authority == null) return false;

        switch (authority) {
            case "discord.com":
            case "ptb.discord.com":
            case "canary.discord.com":
                return true;
            default:
                return false;
        }
    }

    /** A file someone sent in a chat */
    static boolean isDiscordAttachment(Uri url) {
        if (url == null || !"https".equals(url.getScheme())) return false;
        var host = url.getHost();
        var path = url.getPath();
        return path != null && path.startsWith("/attachments/")
                && ("cdn.discordapp.com".equals(host) || "media.discordapp.net".equals(host));
    }

    /** Shows a toast from any thread */
    static void toast(Context ctx, CharSequence text) {
        MAIN.post(() -> Toast.makeText(ctx.getApplicationContext(), text, Toast.LENGTH_SHORT).show());
    }
}
