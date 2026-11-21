package dev.renuxcord.app;

import android.app.Activity;
import android.content.res.Resources;

import androidx.annotation.NonNull;

import java.io.*;
import java.net.HttpURLConnection;
import java.util.Locale;

public class HttpClient {
    public static final class HttpException extends IOException {
        private final HttpURLConnection conn;
        private String message;

        public HttpException(HttpURLConnection conn) {
            this.conn = conn;
        }

        @Override
        @NonNull
        public String getMessage() {
            if (message == null) {
                try(var es = conn.getErrorStream()) {
                    message = String.format(
                            Locale.ENGLISH,
                            "%d: %s (%s)\n%s",
                            conn.getResponseCode(),
                            conn.getResponseMessage(),
                            conn.getURL().toString(),
                            readAsText(es)
                    );
                } catch (IOException ex) {
                    message = "Error while building message lmao. Url is " + conn.getURL().toString();
                }
            }
            return message;
        }
    }

    public static String RenuxcordRuntime;
    public static String MobileRuntime;
    public static String RenuxcordCss;
    /** Renuxcord was downloaded this start, so there's nothing newer to check for */
    public static boolean freshlyInstalled;

    /** Gets Renuxcord ready to go into the page. Downloads it on the first start, so never call it on the main thread */
    public static void fetchRenuxcord(Activity activity) throws IOException {
        if (RenuxcordRuntime != null) return;

        var res = activity.getResources();
        try (var is = res.openRawResource(R.raw.renuxcord_mobile)) {
            MobileRuntime = readAsText(is);
        }

        freshlyInstalled = BundleUpdater.ensureInstalled(activity);
        BundleUpdater.loadBundles(activity);
    }

    static String readAsText(InputStream is) throws IOException {
        if (is == null) return "";

        try (var baos = new ByteArrayOutputStream()) {
            int n;
            byte[] buf = new byte[16384]; // 16 KB
            while ((n = is.read(buf)) > -1) {
                baos.write(buf, 0, n);
            }
            baos.flush();

            //noinspection CharsetObjectCanBeUsed thank you so much android studio but no i do not want to use an sdk33 api ._.
            return baos.toString("UTF-8");
        }
    }
}
