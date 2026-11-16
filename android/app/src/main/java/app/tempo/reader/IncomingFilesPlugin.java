package app.tempo.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONException;

/**
 * "Open with Tempo" (ACTION_VIEW) and "Share to Tempo" (ACTION_SEND / ACTION_SEND_MULTIPLE).
 *
 * The incoming content:// URIs are only readable while we hold the caller's temporary grant, so each
 * file is copied right away into cacheDir/incoming/ (on a background thread) and listed as pending.
 * JS (src/platform/native.ts) is told via the "filesReceived" event, calls takePending(), fetches each
 * copy through the WebView's local server (Capacitor.convertFileSrc, no base64 over the bridge),
 * hands the Files to the normal import queue and calls release() to delete the copies.
 * Shared plain text without a file (e.g. an article shared from a browser) becomes a .txt file.
 */
@CapacitorPlugin(name = "IncomingFiles")
public class IncomingFilesPlugin extends Plugin {

    private static final String DIR = "incoming";
    private static final long STALE_MS = 24L * 60 * 60 * 1000;

    private final List<JSObject> pending = new ArrayList<>();
    private Intent lastIntent;

    @Override
    public void load() {
        // Copies older than a day were never picked up (e.g. the app was killed mid-import).
        File dir = new File(getContext().getCacheDir(), DIR);
        File[] old = dir.listFiles();
        if (old != null) {
            long now = System.currentTimeMillis();
            for (File f : old) if (now - f.lastModified() > STALE_MS) f.delete();
        }
    }

    /** Called by the bridge for the launch intent (BridgeActivity.load) and for every later intent (singleTask). */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || intent == lastIntent) return;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        lastIntent = intent;

        final List<Uri> uris = new ArrayList<>();
        String sharedText = null;
        String sharedTitle = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = getStream(intent);
            if (stream != null) uris.add(stream);
            else {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text != null) sharedText = text.toString();
                sharedTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            }
        } else {
            uris.addAll(getStreams(intent));
        }
        // Mark the intent as handled so an activity re-creation does not import the same files again.
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));

        final String text = sharedText;
        final String title = sharedTitle;
        final String mime = intent.getType();
        new Thread(() -> {
            List<JSObject> copied = new ArrayList<>();
            for (Uri uri : uris) {
                JSObject f = copy(uri, mime);
                if (f != null) copied.add(f);
            }
            if (text != null && !text.trim().isEmpty()) {
                JSObject f = writeText(text, title);
                if (f != null) copied.add(f);
            }
            if (copied.isEmpty()) return;
            synchronized (pending) {
                pending.addAll(copied);
            }
            notifyListeners("filesReceived", new JSObject());
        }, "tempo-incoming").start();
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSArray files = new JSArray();
        synchronized (pending) {
            for (JSObject f : pending) files.put(f);
            pending.clear();
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    @PluginMethod
    public void release(PluginCall call) {
        JSArray paths = call.getArray("paths", new JSArray());
        File dir = new File(getContext().getCacheDir(), DIR);
        try {
            for (Object p : paths.toList()) {
                String path = Uri.parse(String.valueOf(p)).getPath();
                if (path == null) continue;
                File f = new File(path);
                // Only ever delete our own copies.
                if (dir.equals(f.getParentFile())) f.delete();
            }
        } catch (JSONException e) {
            Logger.warn("IncomingFiles", "release: bad paths");
        }
        call.resolve();
    }

    // ---------------------------------------------------------------------------------------------

    @SuppressWarnings("deprecation")
    private static Uri getStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        Object o = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return o instanceof Uri ? (Uri) o : null;
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> getStreams(Intent intent) {
        List<Uri> out = new ArrayList<>();
        List<?> list;
        if (Build.VERSION.SDK_INT >= 33) list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        else list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (list != null) for (Object o : list) if (o instanceof Uri) out.add((Uri) o);
        return out;
    }

    private JSObject copy(Uri uri, String intentMime) {
        ContentResolver resolver = getContext().getContentResolver();
        String name = displayName(resolver, uri);
        String mime = null;
        try {
            mime = resolver.getType(uri);
        } catch (Exception ignored) {}
        if (mime == null || mime.isEmpty()) mime = intentMime != null && !intentMime.contains("*") ? intentMime : "application/octet-stream";
        if (name == null || name.trim().isEmpty()) name = "Book";
        name = name.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]+", " ").trim();
        // Some providers give names without an extension; the importer routes by extension first.
        if (!name.contains(".")) {
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) name = name + "." + ext;
        }
        File out = target();
        if (out == null) return null;
        long size = 0;
        try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                size += n;
            }
        } catch (Exception e) {
            Logger.error("IncomingFiles", "Could not copy " + uri, e);
            out.delete();
            return null;
        }
        return describe(out, name, mime, size);
    }

    private JSObject writeText(String text, String title) {
        File out = target();
        if (out == null) return null;
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = new FileOutputStream(out)) {
            os.write(bytes);
        } catch (Exception e) {
            out.delete();
            return null;
        }
        String base = title != null && !title.trim().isEmpty() ? title.trim() : "Shared text";
        base = base.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]+", " ").trim();
        if (base.length() > 80) base = base.substring(0, 80).trim();
        return describe(out, base + ".txt", "text/plain", bytes.length);
    }

    /** Random on-disk name: the display name may contain characters that break URLs. */
    private File target() {
        File dir = new File(getContext().getCacheDir(), DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) return null;
        return new File(dir, UUID.randomUUID().toString() + ".bin");
    }

    private static JSObject describe(File file, String name, String mime, long size) {
        JSObject f = new JSObject();
        f.put("path", Uri.fromFile(file).toString());
        f.put("name", name);
        f.put("mimeType", mime.toLowerCase(Locale.ROOT));
        f.put("size", size);
        return f;
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        if ("file".equals(uri.getScheme())) return uri.getLastPathSegment();
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) return c.getString(i);
            }
        } catch (Exception ignored) {}
        return uri.getLastPathSegment();
    }
}
