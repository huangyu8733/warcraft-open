package me.hhkj.warcraft;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.documentfile.provider.DocumentFile;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The game is a page: this activity is a window onto it, exactly as the desktop launcher is a
 * window onto the same build. Nothing is copied into the APK, so the app weighs a few megabytes and
 * an update is a reload rather than a new release.
 *
 * The page asks to READ the player's Warcraft III folder, which Android's WebView cannot grant
 * (no File System Access API). This shell answers that in the two places the desktop shell does:
 *
 *  - {@link #pickInstall} opens the system folder picker (Storage Access Framework) and keeps the
 *    grant across launches, so the folder is asked for once rather than every boot.
 *  - {@link #shouldInterceptRequest} serves the folder's contents over the same two routes the
 *    desktop app serves on `ow3-install://` (`/manifest.json` and `/file?path=…`, `Range`
 *    honoured), only on this page's own origin. That is the whole "asset source": no Blizzard
 *    bytes enter the repository or the APK, and nothing is addressable off the device.
 *
 * The page is unchanged: a small script injected before any module runs answers `ow3native` (the
 * desktop preload bridge's name) and rewrites `ow3-install://` fetches to those same-origin
 * routes, so `src/assets/nativeInstall.ts` needs no Android branch.
 */
public class MainActivity extends Activity {
    private static final String TAG = "WarcraftOpen";
    private static final String PAGE = "https://warcraft.hhkj.me/play/";
    /** The origin the page is served from; the injected bridge only exists there. */
    private static final String PAGE_ORIGIN = "https://warcraft.hhkj.me";
    /** Its host, checked on every intercepted request: the install is this page's, not any page's. */
    private static final String PAGE_HOST = "warcraft.hhkj.me";
    /** Where the virtual install hangs off that origin. Mirrors the desktop's `ow3-install://`. */
    private static final String INSTALL_ROOT = "/ow3-install/";
    private static final int REQ_PICK = 0x0A33;
    private static final String PREFS = "ow3android";
    private static final int MAX_MANIFEST_DEPTH = 8;
    private static final int MAX_STORE_DEPTH = 3;
    private static final int MAX_TEXT = 1 << 20;

    private static final Pattern MPQ = Pattern.compile("\\.mpq$", Pattern.CASE_INSENSITIVE);
    private static final Pattern MAP = Pattern.compile("\\.(w3m|w3x)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern CAMPAIGN = Pattern.compile("\\.w3n$", Pattern.CASE_INSENSITIVE);
    private static final Pattern LANGUAGE_FILE =
            Pattern.compile("\\.(zhCN|enUS|voice)\\.json$", Pattern.CASE_INSENSITIVE);
    private static final Pattern IDX = Pattern.compile("^[0-9a-f]{10}\\.idx$", Pattern.CASE_INSENSITIVE);
    private static final Pattern DATA_FILE = Pattern.compile("^data\\.\\d{3}$", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONFIG_HASH = Pattern.compile("^[0-9a-f]{32}$", Pattern.CASE_INSENSITIVE);
    private static final Pattern RANGE = Pattern.compile("^bytes=(\\d+)-(\\d*)$");
    private static final String BUILD_INFO = ".build.info";

    private volatile WebView web;
    private volatile LanRelay lanRelay;
    /** LAN discovery: our datagram out, everybody else's relays in (LanBeacon). */
    private volatile LanBeacon lanBeacon;
    private volatile int pendingPickCall = -1;
    private volatile String pendingPickFlavor = "sd";
    private volatile boolean backHandled;
    private volatile int insetTop, insetRight, insetBottom, insetLeft;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // The page is https and the phone's own relay is ws:// on a LAN address
        // (LanRelay). Without this the WebView refuses that socket as mixed content, and LAN
        // hosting is dead on arrival.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // The page owns every gesture on its surface; the WebView's own zoom would fight the
        // game's camera and the gesture layer's pinch (docs/gesture-control.md).
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        // The page tells "desktop shell" from "Android shell" by this token when it needs to.
        settings.setUserAgentString(settings.getUserAgentString() + " WarcraftOpen/Android");

        // The page is our own build: it keeps its cookies and storage across launches so the
        // install folder and settings survive a restart, and links stay inside the app.
        web.setWebViewClient(new ShellClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "ow3android");
        WebView.setWebContentsDebuggingEnabled(true);

        // Edge-to-edge, with the cutout and the system bars out of the picture: the game draws its
        // own frame and a stray status bar would sit on top of it.
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            rememberInsets(insets);
            return insets;
        });

        installPageBridge();

        // The phone's own relay. It is what lets this app be a LAN HOST rather than only a
        // client of the cloud relay: the page's discovered-server list is fed this address
        // (PAGE_BRIDGE `servers`/`onServers`), and the game then announces its room here.
        // Started on a thread of its own because the accept loop is that call's life.
        lanRelay = new LanRelay();
        new Thread(lanRelay::start, "lan-relay").start();

        // …and the UDP beacon that lets this phone FIND other machines' relays (and be found)
        // without anybody typing an address: the same datagram the desktop's beacon.mjs sends,
        // heard here and handed to the page through `relayServers()` below.
        LanBeacon beacon = new LanBeacon(lanRelay);
        lanBeacon = beacon;
        new Thread(beacon::start, "lan-beacon").start();

        if (savedInstanceState == null) web.loadUrl(PAGE);
        else web.restoreState(savedInstanceState);
    }

    /**
     * Put `ow3native` and the `ow3-install://` rewrite into the page BEFORE its first module runs.
     *
     * `nativeInstall.ts` reads the install through `fetch("ow3-install://…")` and asks the shell
     * for the folder over `window.ow3native`; both have to exist by the time `main.ts` boots, or
     * the page decides it is a browser and puts up the File System Access picker this platform
     * cannot answer. androidx.webkit's document-start injection is the only reliable moment;
     * a shell whose WebView predates it falls back to `onPageStarted`, which is late but usually
     * still before the app's module finishes loading.
     */
    private void installPageBridge() {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(web, PAGE_BRIDGE, java.util.Collections.singleton(PAGE_ORIGIN));
                return;
            } catch (RuntimeException err) {
                Log.w(TAG, "document-start injection refused; falling back to onPageStarted", err);
            }
        }
        earlyInject = true;
    }

    /** True when {@link #installPageBridge} could not use document-start injection. */
    private boolean earlyInject;

    private final class ShellClient extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            // The bridge is the game page's: injecting it into a page the player navigated to
            // would hand that page `ow3native` (and the install routes) as well.
            if (earlyInject && url != null && url.startsWith(PAGE_ORIGIN)) {
                view.evaluateJavascript(PAGE_BRIDGE, null);
            }
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                return answer(request);
            } catch (Exception err) {
                Log.w(TAG, "install request failed: " + request.getUrl(), err);
                return null;
            }
        }
    }

    /** Answer one request if it names the virtual install; null for everything else. */
    private WebResourceResponse answer(WebResourceRequest request) throws Exception {
        Uri uri = request.getUrl();
        String flavor;
        String path;
        if ("ow3-install".equals(uri.getScheme())) {
            flavor = uri.getHost();
            path = uri.getPath();
        } else if ("https".equals(uri.getScheme()) && PAGE_HOST.equals(uri.getHost())
                && uri.getPath() != null && uri.getPath().startsWith(INSTALL_ROOT)) {
            String rest = uri.getPath().substring(INSTALL_ROOT.length());
            int slash = rest.indexOf('/');
            if (slash < 0) return null;
            flavor = rest.substring(0, slash);
            path = rest.substring(slash);
        } else {
            return null;
        }
        if (path == null) return null;

        DocumentFile root = installRoot(flavor);
        if (root == null) return notFound();

        if ("/manifest.json".equals(path)) {
            byte[] body = manifest(root).toString().getBytes(StandardCharsets.UTF_8);
            return new WebResourceResponse("application/json", "utf-8", 200, "OK", cors(), new ByteArrayInputStream(body));
        }
        if ("/file".equals(path)) {
            String rel = uri.getQueryParameter("path");
            DocumentFile file = rel == null ? null : resolve(root, rel);
            if (file == null || !file.isFile()) return notFound();
            return fileResponse(file, request);
        }
        return notFound();
    }

    /** The remembered folder for one line, or null. HD deliberately does not fall back to SD. */
    private DocumentFile installRoot(String flavor) {
        Uri uri = rememberedUri(normalizeFlavor(flavor));
        if (uri == null) return null;
        DocumentFile root = DocumentFile.fromTreeUri(this, uri);
        return root != null && root.exists() && root.isDirectory() ? root : null;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private static String normalizeFlavor(String flavor) {
        return "hd".equals(flavor) ? "hd" : "sd";
    }

    private static String key(String flavor) {
        return "install:" + normalizeFlavor(flavor);
    }

    private Uri rememberedUri(String flavor) {
        String raw = prefs().getString(key(flavor), null);
        return raw == null || raw.isEmpty() ? null : Uri.parse(raw);
    }

    private Map<String, String> cors() {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Headers", "range");
        headers.put("Access-Control-Expose-Headers", "content-length, content-range, accept-ranges");
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", cors(),
                new ByteArrayInputStream("not found".getBytes(StandardCharsets.UTF_8)));
    }

    // ── The manifest: what a folder holds, in the shape src/assets/remoteInstall.ts reads ───────

    private JSONObject manifest(DocumentFile root) throws Exception {
        JSONObject out = new JSONObject();
        JSONArray archives = new JSONArray();
        JSONArray maps = new JSONArray();
        JSONArray languageFiles = new JSONArray();
        JSONArray campaigns = new JSONArray();
        DocumentFile mapsDir = null;
        String customKeys = null;
        for (DocumentFile entry : root.listFiles()) {
            String name = entry.getName();
            if (name == null) continue;
            if (entry.isFile() && MPQ.matcher(name).find()) archives.put(name);
            else if (entry.isDirectory() && "maps".equalsIgnoreCase(name)) mapsDir = entry;
            else if (entry.isFile() && "customkeys.txt".equalsIgnoreCase(name)) customKeys = name;
        }
        if (mapsDir != null) collectMaps(mapsDir, mapsDir.getName(), maps, languageFiles, campaigns, 0);

        out.put("archives", archives);
        out.put("maps", maps);
        out.put("languageFiles", languageFiles);
        out.put("campaigns", campaigns);
        JSONObject casc = collectCasc(root);
        out.put("casc", casc == null ? JSONObject.NULL : casc);
        out.put("customKeys", customKeys == null ? JSONObject.NULL : customKeys);
        return out;
    }

    private static void collectMaps(DocumentFile dir, String prefix, JSONArray maps,
                                    JSONArray language, JSONArray campaigns, int depth) {
        if (dir == null || depth > MAX_MANIFEST_DEPTH) return;
        for (DocumentFile entry : dir.listFiles()) {
            String name = entry.getName();
            if (name == null) continue;
            String rel = prefix + "\\" + name;
            if (entry.isDirectory()) collectMaps(entry, rel, maps, language, campaigns, depth + 1);
            else if (MAP.matcher(name).find()) maps.put(rel);
            else if (CAMPAIGN.matcher(name).find()) campaigns.put(rel);
            else if (LANGUAGE_FILE.matcher(name).find()) language.put(rel);
        }
    }

    /** The CASC pieces a mount needs; null for an MPQ-era folder, which is how the page tells
     *  the two storages apart. Only the LIVE store (`Data\data`, `Data\config`) is walked —
     *  `Data\ecache` is a download cache whose files may be partial (electron/install.mjs). */
    private JSONObject collectCasc(DocumentFile root) throws Exception {
        DocumentFile buildInfo = child(root, BUILD_INFO);
        DocumentFile data = child(root, "Data");
        if (buildInfo == null || !buildInfo.isFile() || data == null || !data.isDirectory()) return null;
        JSONObject out = new JSONObject();
        JSONArray config = new JSONArray();
        JSONArray idx = new JSONArray();
        JSONObject dataFiles = new JSONObject();
        DocumentFile live = child(data, "data");
        DocumentFile configs = child(data, "config");
        if (live != null) walkStore(live, "Data\\data", 0, config, idx, dataFiles);
        if (configs != null) walkStore(configs, "Data\\config", 0, config, idx, dataFiles);
        out.put("buildInfo", BUILD_INFO);
        out.put("config", config);
        out.put("idx", idx);
        out.put("data", dataFiles);
        return out;
    }

    private static void walkStore(DocumentFile dir, String prefix, int depth, JSONArray config,
                                  JSONArray idx, JSONObject data) throws JSONException {
        if (dir == null || depth > MAX_STORE_DEPTH) return;
        for (DocumentFile entry : dir.listFiles()) {
            String name = entry.getName();
            if (name == null) continue;
            String rel = prefix + "\\" + name;
            if (entry.isDirectory()) walkStore(entry, rel, depth + 1, config, idx, data);
            else if (IDX.matcher(name).find()) idx.put(rel);
            else if (DATA_FILE.matcher(name).find()) data.put(String.valueOf(Integer.parseInt(name.substring(5))), rel);
            else if (CONFIG_HASH.matcher(name).find()) config.put(rel);
        }
    }

    /** The folder's `.build.info` version — "1.30.4.11274" — or null. */
    private String installVersion(DocumentFile root) {
        DocumentFile info = child(root, BUILD_INFO);
        if (info == null || !info.isFile()) return null;
        try {
            String[] lines = readText(info).split("\\r?\\n");
            int first = 0;
            while (first < lines.length && lines[first].trim().isEmpty()) first++;
            if (first + 1 >= lines.length) return null;
            String[] columns = lines[first].split("\\|");
            for (int i = 0; i < columns.length; i++) columns[i] = columns[i].split("!")[0].trim();
            for (int r = first + 1; r < lines.length; r++) {
                if (lines[r].trim().isEmpty()) continue;
                String[] cells = lines[r].split("\\|", -1);
                String active = null;
                String version = null;
                for (int i = 0; i < columns.length; i++) {
                    String cell = i < cells.length ? cells[i].trim() : "";
                    if ("Active".equalsIgnoreCase(columns[i])) active = cell;
                    else if ("Version".equalsIgnoreCase(columns[i])) version = cell;
                }
                if (version != null && (active == null || "1".equals(active))) return version;
            }
        } catch (Exception err) {
            Log.w(TAG, "cannot read .build.info", err);
        }
        return null;
    }

    /** Is this folder one the game would take? Same rule as electron/install.mjs `looksLikeInstall`. */
    private boolean looksLikeInstall(DocumentFile root) {
        if (root == null || !root.isDirectory()) return false;
        if (child(root, "Data") == null) return false;
        String version = installVersion(root);
        return version != null && (version.startsWith("1.3") || version.startsWith("3."));
    }

    /** A file in the tree, by install-relative path, spelled however the folder spells it. */
    private static DocumentFile resolve(DocumentFile root, String rel) {
        DocumentFile cur = root;
        for (String segment : rel.split("\\\\")) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) return null;
            cur = child(cur, segment);
            if (cur == null) return null;
        }
        return cur;
    }

    private static DocumentFile child(DocumentFile parent, String name) {
        if (parent == null || !parent.isDirectory() || name == null) return null;
        for (DocumentFile entry : parent.listFiles()) {
            if (name.equalsIgnoreCase(entry.getName())) return entry;
        }
        return null;
    }

    private String readText(DocumentFile file) throws IOException {
        InputStream in = getContentResolver().openInputStream(file.getUri());
        if (in == null) throw new IOException("unreadable");
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = stream.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_TEXT) break;
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8).replace("\uFEFF", "");
        }
    }

    // ── One file, honouring `Range`: the content store is read in slices, never whole ──────────

    /**
     * The file's size, asked of every door the provider offers: the tree's own metadata
     * ({@link DocumentFile#length()}), then the descriptor's stat, then the descriptor's channel.
     * Some providers answer 0 to the first two and still hand out a seekable file. Returns -1
     * when the size genuinely cannot be had — never 0, which would claim an empty file.
     */
    private long measure(DocumentFile file) {
        long size = file.length();
        if (size > 0) return size;
        try (ParcelFileDescriptor probe =
                     getContentResolver().openFileDescriptor(file.getUri(), "r")) {
            if (probe == null) return -1;
            long stat = probe.getStatSize();
            if (stat > 0) return stat;
        } catch (IOException | RuntimeException ignored) {
            // fall through to the channel, which some providers answer where stat does not
        }
        try (ParcelFileDescriptor probe =
                     getContentResolver().openFileDescriptor(file.getUri(), "r");
             ParcelFileDescriptor.AutoCloseInputStream stream =
                     new ParcelFileDescriptor.AutoCloseInputStream(probe)) {
            long channel = stream.getChannel().size();
            return channel > 0 ? channel : -1;
        } catch (IOException | RuntimeException err) {
            return -1;
        }
    }

    private WebResourceResponse fileResponse(DocumentFile file, WebResourceRequest request) throws IOException {
        long size = measure(file);
        String label = file.getName() + " (" + size + ")";

        Map<String, String> headers = cors();
        headers.put("Content-Type", "application/octet-stream");
        headers.put("Accept-Ranges", "bytes");

        // The range comes from the PAGE as `?r=start-end`, not as a `Range` header: WebView fails
        // any intercepted range whose start is not 0, whichever status the answer carries. The
        // bridge rewrites the header before the request leaves the page (PAGE_BRIDGE), and a
        // Range header is still honoured where one does arrive — the desktop shell's route.
        Map<String, String> sent = request.getRequestHeaders();
        String range = sent == null ? null : sent.get("Range");
        if (range == null && sent != null) range = sent.get("range");
        if (range == null) {
            String asked = request.getUrl().getQueryParameter("r");
            if (asked != null) range = "bytes=" + asked;
        }
        long start = 0;
        long requestedEnd = -1; // -1: open-ended, or no Range at all
        boolean ranged = false;
        if (range != null) {
            Matcher m = RANGE.matcher(range.trim());
            if (m.matches()) {
                start = Long.parseLong(m.group(1));
                if (!m.group(2).isEmpty()) requestedEnd = Long.parseLong(m.group(2));
                ranged = true;
            }
        }

        // A known size makes the response EXACT — the mount's ranged data.NNN reads and its HEAD
        // (which takes `content-length` as the file's size) are both built on that.
        if (size > 0) {
            long last = size - 1;
            long end = requestedEnd < 0 ? last : Math.min(requestedEnd, last);
            if (ranged && (start > last || end < start)) {
                headers.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse(null, null, 416, "Range Not Satisfiable", headers, null);
            }
            long from = ranged ? start : 0;
            long count = end - from + 1;
            headers.put("Content-Length", String.valueOf(count));
            // WebView drops an intercepted 206 whose Content-Range starts anywhere but 0 — the
            // fetch then fails with "Failed to fetch" before a byte is read. Answering 200 with
            // the requested slice already in the body is the one form it takes; the page only
            // checks res.ok and reads the bytes, and `no-store` keeps them from being cached as
            // the whole file. (The slice is named in the URL by the bridge, not by a Range header;
            // see PAGE_BRIDGE and the `r` query above.)
            if ("HEAD".equalsIgnoreCase(request.getMethod())) {
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, null);
            }
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                    new LoggedInputStream(openRange(file.getUri(), from, count), label));
        }

        // The provider would not say how big the file is. Declaring a length anyway is a promise
        // the stream cannot keep — Chromium cancels that response as "Failed to fetch", which is
        // how a perfectly readable folder used to fail to mount. So say nothing and let the end
        // of the stream be the end of the body. A Range with an explicit end still bounds the
        // read exactly (the mount's data.NNN slices always send one), and a total of `*` says the
        // length is genuinely unknown.
        Log.w(TAG, "no size for " + file.getUri() + "; serving without content-length");
        if (ranged && requestedEnd >= start) {
            long count = requestedEnd - start + 1;
            headers.put("Content-Length", String.valueOf(count));
            if ("HEAD".equalsIgnoreCase(request.getMethod())) {
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, null);
            }
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                    new LoggedInputStream(openRange(file.getUri(), start, count), label));
        }
        if ("HEAD".equalsIgnoreCase(request.getMethod())) {
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, null);
        }
        return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                new LoggedInputStream(openRange(file.getUri(), start, Long.MAX_VALUE), label));
    }

    /**
     * A seekable read where the provider allows one (`data.NNN` is gigabytes and every mount
     * boot slices it), a skip-ahead stream where it does not.
     */
    private InputStream openRange(Uri uri, long start, long count) throws IOException {
        ContentResolver resolver = getContentResolver();
        ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r");
        if (pfd != null) {
            FileInputStream fis = null;
            try {
                fis = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
                FileChannel channel = fis.getChannel();
                channel.position(start);
                return new LimitedInputStream(fis, count);
            } catch (IOException | RuntimeException err) {
                Log.w(TAG, "seek to " + start + " failed, will skip instead", err);
                if (fis != null) {
                    try {
                        fis.close();
                    } catch (IOException ignored) {
                        // already closed
                    }
                } else {
                    try {
                        pfd.close();
                    } catch (IOException ignored) {
                        // already closed
                    }
                }
            }
        }
        InputStream raw = resolver.openInputStream(uri);
        if (raw == null) throw new IOException("unreadable");
        long skipped = 0;
        while (skipped < start) {
            long n = raw.skip(start - skipped);
            if (n > 0) {
                skipped += n;
            } else if (raw.read() < 0) {
                break;
            } else {
                skipped += 1;
            }
        }
        return new LimitedInputStream(raw, count);
    }

    /** At most `left` bytes of `in`; closing it closes the wrapped stream. */
    private static final class LimitedInputStream extends InputStream {
        private final InputStream in;
        private long left;

        LimitedInputStream(InputStream in, long left) {
            this.in = in;
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b >= 0) left -= 1;
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (left <= 0) return -1;
            int want = (int) Math.min(length, left);
            int n = in.read(buffer, offset, want);
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long skip = Math.min(n, left);
            long done = in.skip(skip);
            if (done > 0) left -= done;
            return done;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(in.available(), Math.max(0, left));
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }

    /** Names the file when its body dies mid-read; Chromium would only say "net::ERR_FAILED". */
    private static final class LoggedInputStream extends InputStream {
        private final InputStream in;
        private final String label;

        LoggedInputStream(InputStream in, String label) {
            this.in = in;
            this.label = label;
        }

        @Override
        public int read() throws IOException {
            try {
                return in.read();
            } catch (IOException err) {
                Log.w(TAG, "body read failed: " + label, err);
                throw err;
            }
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            try {
                return in.read(buffer, offset, length);
            } catch (IOException err) {
                Log.w(TAG, "body read failed: " + label, err);
                throw err;
            }
        }

        @Override
        public long skip(long n) throws IOException {
            return in.skip(n);
        }

        @Override
        public int available() throws IOException {
            return in.available();
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }

    // ── The activity: the folder picker, the back key, insets ─────────────────────────────────

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK) return;
        String answer = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            try {
                getContentResolver().takePersistableUriPermission(
                        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException err) {
                // Some providers grant only for this process; the read still works until restart.
                Log.w(TAG, "the folder grant will not survive a restart", err);
            }
            DocumentFile root = DocumentFile.fromTreeUri(this, uri);
            if (looksLikeInstall(root)) {
                prefs().edit().putString(key(pendingPickFlavor), uri.toString()).apply();
                answer = root.getName();
            }
        }
        finishPick(answer);
    }

    /** The page's answer to `ow3native.pickInstall`: the folder's name, or null when nothing
     *  usable was picked (the page then leaves the old install mounted). */
    private void finishPick(String answer) {
        final int call = pendingPickCall;
        pendingPickCall = -1;
        if (call < 0 || web == null) return;
        final String js = "window.__ow3AndroidPick&&window.__ow3AndroidPick(" + call + ","
                + JSONObject.quote(answer) + ");";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    /**
     * Back means "cancel", not "leave": while the page says it can use one (an armed spell, a
     * menu), it is delivered as an event and the history is left alone. This is the routing the
     * gesture console will hang its `cancel()` on; with nothing listening it steps back through
     * the page exactly as before.
     */
    @Override
    public void onBackPressed() {
        if (backHandled && web != null) {
            web.evaluateJavascript(
                    "window.dispatchEvent(new Event('ow3android:back'));", null);
            return;
        }
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** The page tells us whether a Back press now belongs to it (set from the gesture console). */
    @JavascriptInterface
    public void setBackHandled(boolean handled) {
        backHandled = handled;
    }

    private void rememberInsets(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            insetTop = bars.top;
            insetRight = bars.right;
            insetBottom = bars.bottom;
            insetLeft = bars.left;
        } else {
            insetTop = insets.getSystemWindowInsetTop();
            insetRight = insets.getSystemWindowInsetRight();
            insetBottom = insets.getSystemWindowInsetBottom();
            insetLeft = insets.getSystemWindowInsetLeft();
        }
    }

    /**
     * The activity is not rebuilt on a rotation (the manifest keeps `configChanges`), so the page
     * would otherwise keep the hot-zone rectangles it measured in the other orientation. Tell it
     * the frame moved; the gesture layer re-reads its rects once (方案 §5.3 / P7).
     */
    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        if (web != null) {
            web.evaluateJavascript(
                    "window.dispatchEvent(new Event('ow3android:config'));", null);
        }
    }

    /** What `src/ui/gesture/device.ts` will read for safe-area hot zones. {@link WindowInsets}
     *  reports PHYSICAL pixels; the page converts them with `devicePixelRatio` before comparing
     *  against its CSS-pixel hot zones, so nothing here needs to know the screen density. */
    @JavascriptInterface
    public String safeInsets() {
        return "{\"top\":" + insetTop + ",\"right\":" + insetRight
                + ",\"bottom\":" + insetBottom + ",\"left\":" + insetLeft + "}";
    }

    /**
     * What the page may call. Every method is synchronous and answers a STRING; the injected
     * script does the Promises, because `@JavascriptInterface` has no way back to the page.
     */
    private final class Bridge {
        @JavascriptInterface
        public String platform() {
            return "android-webview";
        }

        @JavascriptInterface
        public String flavor() {
            return prefs().getString("flavor", "sd");
        }

        @JavascriptInterface
        public void setFlavor(String flavor) {
            prefs().edit().putString("flavor", normalizeFlavor(flavor)).apply();
        }

        /** `InstalledFolder` (src/assets/nativeInstall.ts): what the launcher row says. */
        @JavascriptInterface
        public String installPath(String flavor) {
            Uri uri = rememberedUri(flavor);
            DocumentFile root = uri == null ? null : DocumentFile.fromTreeUri(MainActivity.this, uri);
            boolean present = root != null && root.exists() && root.isDirectory();
            String version = present ? installVersion(root) : null;
            JSONObject out = new JSONObject();
            try {
                out.put("path", present ? root.getName() : JSONObject.NULL);
                out.put("valid", present && version != null
                        && (version.startsWith("1.3") || version.startsWith("3.")));
                out.put("present", present);
                out.put("version", version == null ? JSONObject.NULL : version);
            } catch (Exception err) {
                return "{\"path\":null,\"valid\":false,\"present\":false,\"version\":null}";
            }
            return out.toString();
        }

        /**
         * The LAN relay this app is carrying, in the shape `ow3native.servers()` answers
         * (`[{id,url}]`, src/assets/nativeInstall.ts). Empty before the relay has bound, and on
         * a device with no network interface to name.
         */
        @JavascriptInterface
        public String relayServers() {
            LanRelay relay = lanRelay;
            JSONArray out = new JSONArray();
            Set<String> known = new LinkedHashSet<>();
            // Ours FIRST: the page picks the first discovered relay as the default host on
            // Android, and a game created here belongs on the phone's own relay.
            if (relay != null && relay.port() > 0) {
                try {
                    for (String url : relay.urls()) {
                        JSONObject one = new JSONObject();
                        one.put("id", "android-lan");
                        one.put("url", url);
                        out.put(one);
                        known.add(url);
                    }
                } catch (Exception err) {
                    Log.w(TAG, "cannot list relay servers", err);
                    return "[]";
                }
            }
            // …then every other machine the beacon can hear, so their games appear in the LAN
            // join list with nothing typed (LanBeacon reads the desktop's beacon.mjs datagrams).
            LanBeacon beacon = lanBeacon;
            if (beacon != null) {
                try {
                    for (LanBeacon.Peer peer : beacon.peers()) {
                        if (!known.add(peer.url)) continue; // our own address heard back
                        JSONObject one = new JSONObject();
                        one.put("id", peer.id);
                        one.put("url", peer.url);
                        out.put(one);
                    }
                } catch (Exception err) {
                    Log.w(TAG, "cannot list beacon servers", err);
                }
            }
            return out.toString();
        }

        /** Open the system folder picker. The answer arrives at `__ow3AndroidPick(call, name)`. */
        @JavascriptInterface
        public void pickInstall(String flavor, int call) {
            pendingPickFlavor = normalizeFlavor(flavor);
            pendingPickCall = call;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                try {
                    startActivityForResult(intent, REQ_PICK);
                } catch (RuntimeException err) {
                    Log.w(TAG, "no folder picker on this device", err);
                    finishPick(null);
                }
            });
        }

        @JavascriptInterface
        public void forgetInstall(String flavor) {
            prefs().edit().remove(key(flavor)).apply();
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(Math.max(1, ms));
            }
        }

        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        /**
         * The soft keyboard, for the game's own chat field: Android opens its keyboard by itself
         * only for a real focused input, and the game sometimes wants the line up without a tap in
         * the field (`padKeyboard`'s row, a command typed from the console).
         */
        @JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(() -> {
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
            });
        }

        @JavascriptInterface
        public void hideKeyboard() {
            runOnUiThread(() -> {
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null) imm.hideSoftInputFromWindow(web.getWindowToken(), 0);
            });
        }

        /** "landscape" / "portrait" / "sensor" / "unlocked" (the manifest's own default). */
        @JavascriptInterface
        public void setOrientation(String mode) {
            final int value;
            if ("landscape".equals(mode)) value = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
            else if ("portrait".equals(mode)) value = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
            else if ("sensor".equals(mode)) value = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR;
            else value = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
            runOnUiThread(() -> setRequestedOrientation(value));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    /** The relay lives exactly as long as the window: the port and every room go with it. */
    @Override
    protected void onDestroy() {
        LanRelay relay = lanRelay;
        lanRelay = null;
        if (relay != null) relay.stop();
        LanBeacon beacon = lanBeacon;
        lanBeacon = null;
        if (beacon != null) beacon.stop();
        super.onDestroy();
    }

    /**
     * The page's bridge, injected before its first module. Two jobs, both small:
     *
     * 1. Answer `window.ow3native` — the name the desktop preload uses — so `nativeInstall.ts`
     *    reads this shell's folder instead of the File System Access picker, and so the launcher
     *    uses the same rows as the desktop build.
     * 2. Rewrite `ow3-install://<line>/…` fetches onto this page's origin, where
     *    {@link #shouldInterceptRequest} answers them. A custom scheme would need a handler the
     *    WebView does not let a page register; the origin route is the same bytes, same routes,
     *    and same `Range` behaviour.
     */
    private static final String PAGE_BRIDGE = String.join("\n",
            "(function () {",
            "  if (window.__ow3androidBridge) return;",
            "  window.__ow3androidBridge = true;",
            "  var native = window.ow3android;",
            "  if (!native) return;",
            "  var pending = Object.create(null);",
            "  var seq = 0;",
            "  window.__ow3AndroidPick = function (id, answer) {",
            "    var cb = pending[id];",
            "    if (!cb) return;",
            "    delete pending[id];",
            "    cb(answer == null ? null : String(answer));",
            "  };",
            "  function parse(json, fallback) {",
            "    try { return json ? JSON.parse(json) : fallback; } catch (e) { return fallback; }",
            "  }",
            "  var fetch0 = window.fetch ? window.fetch.bind(window) : null;",
            "  function rangeOf(headers) {",
            "    if (!headers) return null;",
            "    if (typeof headers.get === 'function') return headers.get('range');",
            "    return headers.Range || headers.range || null;",
            "  }",
            "  if (fetch0) {",
            "    window.fetch = function (input, init) {",
            "      if (typeof input === 'string' && input.indexOf('ow3-install://') === 0) {",
            "        var out = '/ow3-install/' + input.slice('ow3-install://'.length);",
            "        var asked = rangeOf(init && init.headers);",
            "        var m = asked ? /^bytes=(\\d+)-(\\d*)$/.exec(String(asked).trim()) : null;",
            "        if (m) {",
            "          out += (out.indexOf('?') < 0 ? '?' : '&') + 'r=' + m[1] + '-' + m[2];",
            "          var copy = {};",
            "          if (init.headers && typeof init.headers.forEach === 'function') {",
            "            init.headers.forEach(function (v, k) { copy[k] = v; });",
            "          } else if (init.headers) {",
            "            for (var k in init.headers) copy[k] = init.headers[k];",
            "          }",
            "          delete copy.Range;",
            "          delete copy.range;",
            "          init = Object.assign({}, init, { headers: copy });",
            "        }",
            "        return fetch0(out, init);",
            "      }",
            "      return fetch0(input, init);",
            "    };",
            "  }",
            "  window.ow3native = {",
            "    installPath: function (f) {",
            "      return Promise.resolve(parse(native.installPath(f || 'sd'),",
            "        { path: null, valid: false, present: false, version: null }));",
            "    },",
            "    pickInstall: function (f) {",
            "      return new Promise(function (resolve) {",
            "        var id = ++seq;",
            "        pending[id] = resolve;",
            "        native.pickInstall(f || 'sd', id);",
            "      });",
            "    },",
            "    forgetInstall: function (f) {",
            "      try { native.forgetInstall(f || 'sd'); } catch (e) {}",
            "      return Promise.resolve();",
            "    },",
            "    flavor: {",
            "      get: function () { return Promise.resolve(native.flavor() || 'sd'); },",
            "      set: function (f) {",
            "        try { native.setFlavor(String(f)); } catch (e) {}",
            "        return Promise.resolve(f);",
            "      }",
            "    },",
            "    servers: function () { return Promise.resolve(parse(native.relayServers(), [])); },",
            "    onServers: function (fn) {",
            "      var last = null;",
            "      function tick() {",
            "        var now = parse(native.relayServers(), []);",
            "        var key = JSON.stringify(now);",
            "        if (key !== last) { last = key; fn(now); }",
            "      }",
            "      tick();",
            "      var timer = setInterval(tick, 3000);",
            "      return function () { clearInterval(timer); };",
            "    }",
            "  };",
            "})();");
}
