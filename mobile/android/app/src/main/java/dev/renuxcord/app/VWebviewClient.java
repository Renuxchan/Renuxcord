package dev.renuxcord.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.webkit.*;

import androidx.annotation.Nullable;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;

public class VWebviewClient extends WebViewClient {
    private final MainActivity activity;

    public VWebviewClient(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        var url = request.getUrl();
        if (Utils.isDiscordUrl(url) || "about:blank".equals(url.toString())) {
            return false;
        }

        // Tapping a file in a chat downloads it here instead of bouncing out to the browser
        if (Utils.isDiscordAttachment(url)) {
            Downloads.download(activity, url.toString(), view.getSettings().getUserAgentString(), null, null);
            return true;
        }

        try {
            view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException ex) {
            Logger.w("Nothing on this phone opens " + url.getScheme() + " links");
        }
        return true;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        activity.onPageStarted();
        view.evaluateJavascript(HttpClient.RenuxcordRuntime, null);
        view.evaluateJavascript(HttpClient.MobileRuntime, null);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        activity.onPageFinished();
        super.onPageFinished(view, url);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) activity.onPageFailed(error.getDescription());
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        activity.onWebViewCrashed();
        return true;
    }

    @Nullable
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        var path = req.getUrl().getPath();
        if (req.isForMainFrame() || (path != null && path.endsWith(".css"))) {
            try {
                return doFetch(req);
            } catch (IOException ex) {
                Logger.e("Error during shouldInterceptRequest", ex);
            }
        }
        return null;
    }

    private WebResourceResponse doFetch(WebResourceRequest req) throws IOException {
        var url = req.getUrl().toString();
        var conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(req.getMethod());
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        for (var h : req.getRequestHeaders().entrySet()) {
            conn.setRequestProperty(h.getKey(), h.getValue());
        }

        var code = conn.getResponseCode();
        var msg = conn.getResponseMessage();
        // Redirects and errors: WebView loads those itself (WebResourceResponse can't carry a redirect)
        if (code < 200 || code >= 300) {
            conn.disconnect();
            return null;
        }

        var headers = conn.getHeaderFields();
        var modifiedHeaders = new HashMap<String, String>(headers.size());
        for (var header : headers.entrySet()) {
            if (header.getKey() != null && !"Content-Security-Policy".equalsIgnoreCase(header.getKey())) {
                modifiedHeaders.put(header.getKey(), header.getValue().get(0));
            }
        }
        if (url.endsWith(".css")) modifiedHeaders.put("Content-Type", "text/css");

        var contentType = modifiedHeaders.get("Content-Type");
        if (contentType == null) contentType = "application/octet-stream";
        // "text/html; charset=utf-8" has to be split, or WebView treats the whole thing as the MIME type
        var mimeType = contentType.split(";")[0].trim();

        return new WebResourceResponse(mimeType, "utf-8", code, msg == null || msg.isEmpty() ? "OK" : msg, modifiedHeaders, conn.getInputStream());
    }
}
