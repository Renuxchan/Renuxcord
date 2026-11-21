package dev.renuxcord.app;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

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
            if (wv.canGoBack())
                wv.goBack();
            else
                // no idea what i was smoking when I wrote this
                activity.getActionBar();
        });
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
}
