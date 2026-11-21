package dev.renuxcord.app;

import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.URLUtil;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** Saves files from Discord into the phone's Downloads folder */
final class Downloads {
    /** Links: Android's download manager fetches them, with a progress notification */
    static void download(MainActivity activity, String url, String userAgent, String contentDisposition, String mimeType) {
        var uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) {
            // blob: and data: downloads come through RenuxcordNative.saveFile from the page script instead
            return;
        }

        activity.withStoragePermission(() -> {
            try {
                var name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                var request = new DownloadManager.Request(uri)
                        .setTitle(name)
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                if (mimeType != null && !mimeType.isEmpty()) request.setMimeType(mimeType);
                if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
                var cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);

                var dm = activity.getSystemService(DownloadManager.class);
                dm.enqueue(request);
                Utils.toast(activity, activity.getString(R.string.downloading_file, name));
            } catch (Exception ex) {
                Logger.e("Download failed", ex);
                Utils.toast(activity, activity.getString(R.string.save_failed));
            }
        });
    }

    /** Bytes the page hands over (blob: and data: downloads, like Renuxcord's own exporters) */
    static void save(MainActivity activity, String name, String mimeType, byte[] data) {
        activity.withStoragePermission(() -> new Thread(() -> {
            var fileName = cleanName(name);
            try {
                write(activity, fileName, mimeType, data);
                Utils.toast(activity, activity.getString(R.string.saved_file, fileName));
            } catch (IOException ex) {
                Logger.e("Saving " + fileName + " failed", ex);
                Utils.toast(activity, activity.getString(R.string.save_failed));
            }
        }, "renuxcord-save").start());
    }

    private static void write(Context ctx, String name, String mimeType, byte[] data) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var resolver = ctx.getContentResolver();
            var values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            var item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (item == null) throw new IOException("Couldn't create " + name);
            try (var os = resolver.openOutputStream(item)) {
                if (os == null) throw new IOException("Couldn't open " + name);
                os.write(data);
            } catch (IOException ex) {
                resolver.delete(item, null, null);
                throw ex;
            }

            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(item, values, null, null);
            return;
        }

        var dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No Downloads folder");
        var file = new File(dir, name);
        var dot = name.lastIndexOf('.');
        for (int i = 1; file.exists(); i++) {
            file = new File(dir, dot > 0 ? name.substring(0, dot) + " (" + i + ")" + name.substring(dot) : name + " (" + i + ")");
        }
        try (var os = new FileOutputStream(file)) {
            os.write(data);
        }
    }

    private static String cleanName(String name) {
        var clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        return clean.isEmpty() ? "download" : clean.length() > 120 ? clean.substring(clean.length() - 120) : clean;
    }
}
