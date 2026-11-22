package dev.renuxcord.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.regex.Pattern;

public class AppSettings {
    public static final String BRANCH_STABLE = "stable";
    public static final String BRANCH_PTB = "ptb";
    public static final String BRANCH_CANARY = "canary";

    private static final String PREFS_NAME = "app_settings";
    private static final String KEY_DESKTOP_UI = "desktop_ui";
    private static final String KEY_AUTO_UPDATES = "auto_updates";
    private static final String KEY_INSTALLED_HASH = "installed_hash";
    private static final String KEY_BRANCH = "branch";
    private static final String KEY_ASKED_NOTIFICATIONS = "asked_notifications";
    private static final String KEY_STAY_CONNECTED = "stay_connected";
    /** Renuxcord's page plugin (PhoneMode) looks for this to know it runs in the app */
    private static final String APP_MARKER = " RenuxcordApp/1";
    private static final Pattern CHROME_VERSION = Pattern.compile("Chrome/[\\d.]+");

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** Discord's full app (calls, discovery, menus) in Renuxcord's phone layout. Off means Discord's own phone site */
    public static boolean isDesktopUiEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_DESKTOP_UI, true);
    }

    public static void setDesktopUiEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean(KEY_DESKTOP_UI, enabled).apply();
    }

    public static boolean isAutoUpdatesEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_AUTO_UPDATES, true);
    }

    public static void setAutoUpdatesEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean(KEY_AUTO_UPDATES, enabled).apply();
    }

    public static String getInstalledHash(Context ctx) {
        return prefs(ctx).getString(KEY_INSTALLED_HASH, null);
    }

    public static void setInstalledHash(Context ctx, String hash) {
        prefs(ctx).edit().putString(KEY_INSTALLED_HASH, hash).apply();
    }

    public static String getBranch(Context ctx) {
        return prefs(ctx).getString(KEY_BRANCH, BRANCH_STABLE);
    }

    public static void setBranch(Context ctx, String branch) {
        prefs(ctx).edit().putString(KEY_BRANCH, branch).apply();
    }

    public static boolean askedForNotifications(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ASKED_NOTIFICATIONS, false);
    }

    public static void setAskedForNotifications(Context ctx) {
        prefs(ctx).edit().putBoolean(KEY_ASKED_NOTIFICATIONS, true).apply();
    }

    public static boolean isStayConnectedEnabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_STAY_CONNECTED, true);
    }

    public static void setStayConnectedEnabled(Context ctx, boolean enabled) {
        prefs(ctx).edit().putBoolean(KEY_STAY_CONNECTED, enabled).apply();
    }

    // Without "Android" or "Mobile" in it, Discord runs its full app: voice and video, Server Discovery, every menu.
    // Android is Linux, so that's what it says
    public static String desktopUserAgent(String currentUserAgent) {
        var matcher = CHROME_VERSION.matcher(currentUserAgent);
        var chromeVersion = matcher.find() ? matcher.group() : "Chrome/141.0.0.0";
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                + chromeVersion + " Safari/537.36" + APP_MARKER;
    }

    public static String phoneUserAgent(String currentUserAgent) {
        return currentUserAgent + APP_MARKER;
    }
}
