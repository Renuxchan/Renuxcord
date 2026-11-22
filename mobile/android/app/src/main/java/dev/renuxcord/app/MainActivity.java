package dev.renuxcord.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.StrictMode;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.RadioGroup;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Objects;

public class MainActivity extends Activity {
    public static final int FILECHOOSER_RESULTCODE = 8485;
    private static final int MEDIA_PERMISSIONS = 8486;
    private static final int NOTIFICATION_PERMISSION = 8487;
    private static final int STORAGE_PERMISSION = 8488;
    static final String EXTRA_NOTIFICATION = "dev.renuxcord.app.NOTIFICATION";

    private boolean wvInitialized = false;
    private boolean pageFailed = false;
    private boolean pageShown = false;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable showPageAnyway = this::showPage;
    private WebView wv;
    private View loadingView;
    private View errorView;
    private TextView errorMessage;
    private String defaultUserAgent;
    private Uri pendingUrl;
    private PermissionRequest pendingMediaRequest;
    private Runnable pendingStorageAction;

    public ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // https://developer.chrome.com/docs/devtools/remote-debugging/webviews/
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        setContentView(R.layout.activity_main);

        wv = findViewById(R.id.webview);
        loadingView = findViewById(R.id.loading);
        errorView = findViewById(R.id.error_view);
        errorMessage = findViewById(R.id.error_message);
        findViewById(R.id.error_retry).setOnClickListener(v -> retry());

        applyWindowInsets();
        explodeAndroid();
        Notifier.createChannel(this);

        // Discord's dark background behind the page: Discord paints over it in whichever theme you use
        wv.setBackgroundColor(getColor(R.color.background));
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);

        wv.setWebViewClient(new VWebviewClient(this));
        wv.setWebChromeClient(new VChromeClient(this));
        wv.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                Downloads.download(this, url, userAgent, contentDisposition, mimeType));

        var s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Discord has its own text size setting; the phone's font size would only break its layout
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // Smoother scrolling: the page is drawn a little ahead of where you scroll
        s.setOffscreenPreRaster(true);
        // The page keeps running in the background (calls, notifications) instead of Android pausing it first
        wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        // Login captchas run in a frame from another site
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);

        defaultUserAgent = s.getUserAgentString();
        applyUserAgent();

        wv.addJavascriptInterface(new RenuxcordNative(this, wv), "RenuxcordNative");
        KeepAlive.update(this);

        Intent intent = getIntent();
        if (Objects.equals(intent.getAction(), Intent.ACTION_VIEW)) pendingUrl = intent.getData();

        startRenuxcord();
    }

    // The first start downloads Renuxcord, so it never runs on the main thread (that froze the app before)
    private void startRenuxcord() {
        showLoading();
        new Thread(() -> {
            try {
                HttpClient.fetchRenuxcord(this);
                runOnUiThread(this::openDiscord);
            } catch (IOException ex) {
                Logger.e("Failed to fetch Renuxcord", ex);
                runOnUiThread(() -> showError(getString(R.string.renuxcord_download_failed)));
            }
        }, "renuxcord-start").start();
    }

    private void openDiscord() {
        if (isDestroyed()) return;
        var url = pendingUrl;
        pendingUrl = null;
        wv.loadUrl(url != null && Utils.isDiscordUrl(url)
                ? url.toString()
                : DiscordBranch.getWebUrl(this) + "channels/@me");
        wvInitialized = true;

        // Updates download in the background and load the next time the app starts
        if (!HttpClient.freshlyInstalled && AppSettings.isAutoUpdatesEnabled(this)) {
            new Thread(() -> BundleUpdater.autoUpdate(this), "renuxcord-update").start();
        }
    }

    private void showLoading() {
        errorView.setVisibility(View.GONE);
        loadingView.setVisibility(View.VISIBLE);
    }

    void onPageStarted() {
        pageFailed = false;
        pageShown = false;
        ui.removeCallbacks(showPageAnyway);
    }

    // The page finishes loading a few seconds before Discord draws anything, so the loading screen stays up until
    // the page script says Discord is on screen (no white flash), or 15 seconds at most
    void onPageFinished() {
        if (pageFailed || pageShown) return;
        ui.removeCallbacks(showPageAnyway);
        ui.postDelayed(showPageAnyway, 15000);
    }

    void onDiscordDrawn() {
        runOnUiThread(this::showPage);
    }

    private void showPage() {
        ui.removeCallbacks(showPageAnyway);
        if (pageFailed || wv == null) return;
        pageShown = true;
        wv.setVisibility(View.VISIBLE);
        loadingView.setVisibility(View.GONE);
        errorView.setVisibility(View.GONE);
    }

    void onPageFailed(CharSequence description) {
        pageFailed = true;
        Logger.w("Discord failed to load: " + description);
        showError(getString(R.string.error_offline));
    }

    private void showError(String message) {
        loadingView.setVisibility(View.GONE);
        wv.setVisibility(View.INVISIBLE);
        errorMessage.setText(message);
        errorView.setVisibility(View.VISIBLE);
    }

    private void retry() {
        if (!wvInitialized) {
            startRenuxcord();
            return;
        }
        showLoading();
        var current = wv.getUrl();
        if (current == null || current.startsWith("data:") || current.equals("about:blank")) {
            wv.loadUrl(DiscordBranch.getWebUrl(this) + "channels/@me");
        } else {
            wv.reload();
        }
    }

    // The page's renderer died (low memory, a WebView update): start over instead of the whole app closing
    void onWebViewCrashed() {
        Logger.w("WebView renderer is gone, recreating the activity");
        recreate();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(showPageAnyway);
        KeepAlive.stop(this);
        if (wv != null) {
            if (wv.getParent() instanceof ViewGroup) ((ViewGroup) wv.getParent()).removeView(wv);
            wv.destroy();
            wv = null;
        }
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && wv != null && errorView.getVisibility() != View.VISIBLE && wvInitialized) {
            runOnUiThread(() -> wv.evaluateJavascript("window.RenuxcordMobile ? RenuxcordMobile.onBackPress() : false", r -> {
                // Like Discord's own app: back on the home screen sends it to the background, still connected
                if ("false".equals(r)) moveTaskToBack(true);
            }));
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // ---- calls: the mic and camera for Discord's voice and video ----

    void onMediaPermissionRequest(PermissionRequest request) {
        runOnUiThread(() -> {
            if (!Utils.isDiscordUrl(request.getOrigin())) {
                request.deny();
                return;
            }

            var missing = new ArrayList<String>();
            for (var resource : request.getResources()) {
                var permission = androidPermissionFor(resource);
                if (permission == null) {
                    // Protected media and anything else Discord doesn't need
                    request.deny();
                    return;
                }
                if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
            }

            if (missing.isEmpty()) {
                request.grant(request.getResources());
                return;
            }
            if (pendingMediaRequest != null) pendingMediaRequest.deny();
            pendingMediaRequest = request;
            requestPermissions(missing.toArray(new String[0]), MEDIA_PERMISSIONS);
        });
    }

    void onMediaPermissionCanceled(PermissionRequest request) {
        runOnUiThread(() -> {
            if (pendingMediaRequest == request) pendingMediaRequest = null;
        });
    }

    private static String androidPermissionFor(String resource) {
        switch (resource) {
            case PermissionRequest.RESOURCE_AUDIO_CAPTURE:
                return Manifest.permission.RECORD_AUDIO;
            case PermissionRequest.RESOURCE_VIDEO_CAPTURE:
                return Manifest.permission.CAMERA;
            default:
                return null;
        }
    }

    // WebView only takes all of a request or none of it
    private void answerMediaRequest(PermissionRequest request) {
        for (var resource : request.getResources()) {
            var permission = androidPermissionFor(resource);
            if (permission == null || checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                request.deny();
                Toast.makeText(this, R.string.media_permission_denied, Toast.LENGTH_LONG).show();
                return;
            }
        }
        request.grant(request.getResources());
    }

    // ---- notifications ----

    String notificationPermission() {
        if (!Notifier.enabled(this)) {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !AppSettings.askedForNotifications(this)
                    ? "default"
                    : "denied";
        }
        return "granted";
    }

    void requestNotificationPermission() {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !Notifier.enabled(this)
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                AppSettings.setAskedForNotifications(this);
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
            } else {
                reportNotificationPermission();
            }
        });
    }

    private void reportNotificationPermission() {
        if (wv == null) return;
        wv.evaluateJavascript("window.RenuxcordMobile?.notificationPermissionChanged(" + JSONObject.quote(notificationPermission()) + ")", null);
    }

    private void handleNotificationTap(Intent intent) {
        if (intent == null || !intent.hasExtra(EXTRA_NOTIFICATION) || wv == null) return;
        int id = intent.getIntExtra(EXTRA_NOTIFICATION, 0);
        intent.removeExtra(EXTRA_NOTIFICATION);
        wv.evaluateJavascript("window.RenuxcordMobile?.notificationClicked(" + id + ")", null);
    }

    // ---- downloads on Android 8 and 9, which need the storage permission ----

    void withStoragePermission(Runnable action) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT > Build.VERSION_CODES.P
                    || checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
                action.run();
                return;
            }
            pendingStorageAction = action;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION);
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        switch (requestCode) {
            case MEDIA_PERMISSIONS:
                if (pendingMediaRequest != null) answerMediaRequest(pendingMediaRequest);
                pendingMediaRequest = null;
                break;
            case NOTIFICATION_PERMISSION:
                reportNotificationPermission();
                break;
            case STORAGE_PERMISSION:
                var action = pendingStorageAction;
                pendingStorageAction = null;
                if (action != null && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) action.run();
                else Toast.makeText(this, R.string.save_failed, Toast.LENGTH_SHORT).show();
                break;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent intent) {
        if (requestCode != FILECHOOSER_RESULTCODE || filePathCallback == null)
            return;

        if (resultCode != RESULT_OK || intent == null) {
            filePathCallback.onReceiveValue(null);
        } else {
            Uri[] uris;
            try {
                var clipData = intent.getClipData();
                if (clipData != null) { // multiple items
                    uris = new Uri[clipData.getItemCount()];
                    for (int i = 0; i < clipData.getItemCount(); i++) {
                        uris[i] = clipData.getItemAt(i).getUri();
                    }
                } else { // single item
                    uris = new Uri[] { intent.getData() };
                }
            } catch (Exception ex) {
                Logger.e("Error during file upload", ex);
                uris = null;
            }

            filePathCallback.onReceiveValue(uris);
        }
        filePathCallback = null;
    }

    private void applyWindowInsets() {
        var root = findViewById(R.id.root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                var bars = insets.getInsets(
                        WindowInsets.Type.systemBars()
                                | WindowInsets.Type.displayCutout()
                                | WindowInsets.Type.ime()
                );
                left = bars.left;
                top = bars.top;
                right = bars.right;
                bottom = bars.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(left, top, right, bottom);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? WindowInsets.CONSUMED
                    : insets.consumeSystemWindowInsets();
        });
    }

    private void explodeAndroid() {
        StrictMode.setThreadPolicy(
                new StrictMode.ThreadPolicy.Builder()
                        .permitNetwork()
                        .build()
        );
    }

    private void applyUserAgent() {
        var s = wv.getSettings();
        s.setUserAgentString(
                AppSettings.isDesktopUiEnabled(this)
                        ? AppSettings.desktopUserAgent(defaultUserAgent)
                        : AppSettings.phoneUserAgent(defaultUserAgent)
        );
    }

    public void openAppSettings() {
        var view = getLayoutInflater().inflate(R.layout.dialog_app_settings, null);

        Switch desktopUiSwitch = view.findViewById(R.id.desktop_ui_switch);
        desktopUiSwitch.setChecked(AppSettings.isDesktopUiEnabled(this));
        desktopUiSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            AppSettings.setDesktopUiEnabled(this, isChecked);
            applyUserAgent();
            wv.reload();
        });

        Switch stayConnectedSwitch = view.findViewById(R.id.stay_connected_switch);
        stayConnectedSwitch.setChecked(AppSettings.isStayConnectedEnabled(this));
        stayConnectedSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            AppSettings.setStayConnectedEnabled(this, isChecked);
            KeepAlive.update(this);
        });

        RadioGroup branchRadio = view.findViewById(R.id.branch_group);
        branchRadio.check(DiscordBranch.getRadioButtonId(this));

        final var dialog = new AlertDialog.Builder(this)
                .setTitle(R.string.app_settings)
                .setView(view)
                .setPositiveButton(android.R.string.ok, null)
                .show();

        branchRadio.setOnCheckedChangeListener((group, checkedId) -> {
            if (checkedId == DiscordBranch.getRadioButtonId(this)) return;

            DiscordBranch.setFromRadioButtonId(this, checkedId);
            Toast.makeText(this, R.string.switching_discord_branch, Toast.LENGTH_SHORT).show();
            wv.loadUrl(DiscordBranch.getWebUrl(this) + "channels/@me");
            dialog.dismiss();
        });
    }

    public void openUpdaterDialog() {
        UpdaterDialog.show(this, wv::reload, null);
    }

    public void handleUrl(Uri url) {
        if (url == null || !Utils.isDiscordUrl(url)) return;
        if (!wvInitialized) {
            pendingUrl = url;
            return;
        }
        // Quoted: the link comes from outside the app, and must never turn into code in the page
        var path = JSONObject.quote(url.getPath() == null ? "/" : url.getPath());
        wv.evaluateJavascript("Vencord.Webpack.Common.NavigationRouter.transitionTo(" + path + ")", null);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.hasExtra(EXTRA_NOTIFICATION)) {
            handleNotificationTap(intent);
            return;
        }
        Uri data = intent.getData();
        if (data != null) handleUrl(data);
    }
}
