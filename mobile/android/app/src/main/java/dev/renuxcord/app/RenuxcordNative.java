package dev.renuxcord.app;

import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/** What the page script (renuxcord_mobile.js) can ask the app for */
public class RenuxcordNative {
    private final WebView wv;
    private final MainActivity activity;

    public RenuxcordNative(MainActivity activity, WebView wv) {
        this.activity = activity;
        this.wv = wv;
    }

    @JavascriptInterface
    public void goBack() {
        activity.runOnUiThread(() -> {
            if (wv.canGoBack()) wv.goBack();
        });
    }

    /** A long press opened a menu */
    @JavascriptInterface
    public void haptic() {
        activity.runOnUiThread(() -> wv.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS));
    }

    /** Joined or left a voice channel: keeps the mic and the call going while the app is in the background */
    @JavascriptInterface
    public void setInCall(boolean on) {
        activity.runOnUiThread(() -> KeepAlive.setInCall(activity, on));
    }

    @JavascriptInterface
    public void openAppSettings() {
        activity.runOnUiThread(activity::openAppSettings);
    }

    @JavascriptInterface
    public void openBundleUpdater() {
        activity.runOnUiThread(activity::openUpdaterDialog);
    }

    @JavascriptInterface
    public String getRenuxcordCss() {
        return HttpClient.RenuxcordCss == null ? "" : HttpClient.RenuxcordCss;
    }

    /** Discord has drawn itself, so the loading screen can go */
    @JavascriptInterface
    public void discordDrawn() {
        activity.onDiscordDrawn();
    }

    @JavascriptInterface
    public String notificationPermission() {
        return activity.notificationPermission();
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        activity.requestNotificationPermission();
    }

    @JavascriptInterface
    public void showNotification(int id, String title, String body, String icon) {
        Notifier.show(activity, id, title == null ? "" : title, body == null ? "" : body, icon);
    }

    @JavascriptInterface
    public void closeNotification(int id) {
        Notifier.cancel(activity, id);
    }

    @JavascriptInterface
    public void saveFile(String name, String mimeType, String base64) {
        byte[] data;
        try {
            data = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException ex) {
            toast(activity.getString(R.string.save_failed));
            return;
        }
        Downloads.save(activity, name, mimeType, data);
    }

    @JavascriptInterface
    public void toast(String text) {
        if (text != null && !text.isEmpty()) Utils.toast(activity, text.length() > 200 ? text.substring(0, 200) : text);
    }
}
