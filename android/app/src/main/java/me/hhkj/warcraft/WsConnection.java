package me.hhkj.warcraft;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * One WebSocket connection, spoken by hand: the RFC 6455 server side of what
 * {@code server/wsAdapter.mjs} gets from the `ws` package.
 *
 * <p>Written rather than depended on because this app's Gradle build runs {@code --offline} and
 * stays that way: a library is a dependency the build cannot fetch. What the relay needs is
 * small — a handshake, frames, ping/pong — and it is all here.
 *
 * <p>This class owns bytes and nothing else. JSON is parsed one level up
 * ({@link LanRelay}), and rooms are {@link RelayCore}'s.
 */
final class WsConnection implements RelayCore.Conn {
    private static final String TAG = "WarcraftOpen";
    /** RFC 6455 §1.3. */
    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    /** A frame larger than this is refused rather than allocated — map chunks are far smaller. */
    private static final int MAX_FRAME = 8 << 20;
    /** An HTTP upgrade that has not ended its headers by now is not one of ours. */
    private static final int MAX_HANDSHAKE = 16 << 10;

    interface Listener {
        void onOpen(WsConnection conn);

        void onText(WsConnection conn, String text);

        void onClose(WsConnection conn);
    }

    private final Socket socket;
    private final Listener listener;
    private final Object writeLock = new Object();

    private volatile boolean open = true;
    /** A ping was sent and its pong has not arrived; the next sweep terminates (wsAdapter.mjs). */
    private volatile boolean awaitingPong = false;

    private InputStream in;
    private OutputStream out;

    WsConnection(Socket socket, Listener listener) {
        this.socket = socket;
        this.listener = listener;
    }

    void start() {
        Thread reader = new Thread(this::run, "ws-" + socket.getPort());
        reader.setDaemon(true);
        reader.start();
    }

    /** True between a ping and its pong. The sweep reads it, then sets it ({@link #expectPong}). */
    boolean awaitingPong() {
        return awaitingPong;
    }

    void expectPong() {
        awaitingPong = true;
    }

    private void run() {
        boolean announced = false;
        try {
            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);
            in = socket.getInputStream();
            out = socket.getOutputStream();
            if (!handshake()) {
                closeSocket();
                return;
            }
            open = true;
            announced = true;
            listener.onOpen(this);
            readLoop();
        } catch (IOException err) {
            // A closed socket and a peer that vanished are the same thing here.
        } catch (RuntimeException err) {
            Log.w(TAG, "websocket failed", err);
        } finally {
            open = false;
            closeSocket();
            if (announced) listener.onClose(this);
        }
    }

    // ── the upgrade ────────────────────────────────────────────────────────────────────

    private boolean handshake() throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int state = 0; // how much of CRLFCRLF has been seen
        int count = 0;
        while (state < 4) {
            int b = in.read();
            if (b < 0) return false;
            head.write(b);
            if (++count > MAX_HANDSHAKE) return false;
            if (b == (state % 2 == 0 ? '\r' : '\n')) state++;
            else state = b == '\r' ? 1 : 0;
        }

        String[] lines = new String(head.toByteArray(), StandardCharsets.UTF_8).split("\r\n");
        if (lines.length == 0 || !lines[0].startsWith("GET ")) return reject();
        String key = null;
        boolean upgrade = false;
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon < 0) continue;
            String name = lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = lines[i].substring(colon + 1).trim();
            if ("sec-websocket-key".equals(name)) key = value;
            else if ("upgrade".equals(name)) upgrade = value.toLowerCase(Locale.ROOT).contains("websocket");
        }
        if (!upgrade || key == null || key.isEmpty()) return reject();

        String accept;
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            byte[] digest = sha1.digest((key + GUID).getBytes(StandardCharsets.ISO_8859_1));
            accept = Base64.encodeToString(digest, Base64.NO_WRAP);
        } catch (Exception err) {
            Log.w(TAG, "cannot compute Sec-WebSocket-Accept", err);
            return reject();
        }
        // No Sec-WebSocket-Extensions in the answer: we negotiate nothing, so Chromium sends
        // uncompressed frames.
        String response = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        synchronized (writeLock) {
            out.write(response.getBytes(StandardCharsets.US_ASCII));
            out.flush();
        }
        return true;
    }

    private boolean reject() throws IOException {
        synchronized (writeLock) {
            out.write(("HTTP/1.1 400 Bad Request\r\n"
                    + "Content-Length: 0\r\nConnection: close\r\n\r\n")
                    .getBytes(StandardCharsets.US_ASCII));
            out.flush();
        }
        return false;
    }

    // ── frames ─────────────────────────────────────────────────────────────────────────

    private void readLoop() throws IOException {
        ByteArrayOutputStream fragments = null;
        int fragmentOpcode = 0;
        while (open) {
            int b0 = in.read();
            if (b0 < 0) return;
            int b1 = in.read();
            if (b1 < 0) return;

            boolean fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0F;
            boolean masked = (b1 & 0x80) != 0;
            long length = b1 & 0x7F;
            if (length == 126) length = readUnsigned(2);
            else if (length == 127) length = readUnsigned(8);
            // A negative length here is the 64-bit field's top bit: nothing legitimate is
            // that large, and both cases are refused rather than allocated.
            if (length < 0 || length > MAX_FRAME) {
                close();
                return;
            }

            byte[] mask = null;
            if (masked) {
                mask = new byte[4];
                readFully(mask, 0, 4);
            }
            int size = (int) length;
            byte[] payload = new byte[size];
            readFully(payload, 0, size);
            if (mask != null) {
                for (int i = 0; i < size; i++) payload[i] ^= mask[i & 3];
            }

            switch (opcode) {
                case 0x8: // close: echo an empty close frame and let `finally` finish the job
                    writeFrame(0x8, new byte[0]);
                    return;
                case 0x9: // ping
                    writeFrame(0xA, payload);
                    break;
                case 0xA: // pong
                    awaitingPong = false;
                    break;
                case 0x1: // text
                case 0x2: // binary (carried for fragmentation's sake; never dispatched)
                    if (fin) {
                        if (opcode == 0x1) listener.onText(this, new String(payload, StandardCharsets.UTF_8));
                    } else {
                        fragments = new ByteArrayOutputStream();
                        fragmentOpcode = opcode;
                        fragments.write(payload, 0, size);
                        if (fragments.size() > MAX_FRAME) {
                            close();
                            return;
                        }
                    }
                    break;
                case 0x0: // continuation
                    if (fragments == null) break;
                    fragments.write(payload, 0, size);
                    if (fragments.size() > MAX_FRAME) {
                        close();
                        return;
                    }
                    if (fin) {
                        if (fragmentOpcode == 0x1) {
                            listener.onText(this, new String(fragments.toByteArray(), StandardCharsets.UTF_8));
                        }
                        fragments = null;
                    }
                    break;
                default: // reserved opcodes: ignore the payload, stay connected
                    break;
            }
        }
    }

    private long readUnsigned(int bytes) throws IOException {
        long value = 0;
        for (int i = 0; i < bytes; i++) {
            int b = in.read();
            if (b < 0) throw new EOFException();
            value = (value << 8) | (b & 0xFF);
        }
        return value;
    }

    private void readFully(byte[] buffer, int offset, int length) throws IOException {
        int done = 0;
        while (done < length) {
            int n = in.read(buffer, offset + done, length - done);
            if (n < 0) throw new EOFException();
            done += n;
        }
    }

    // ── sending ───────────────────────────────────────────────────────────────────────

    @Override
    public void send(JSONObject msg) {
        sendText(msg.toString());
    }

    void sendText(String text) {
        writeFrame(0x1, text.getBytes(StandardCharsets.UTF_8));
    }

    void ping() {
        writeFrame(0x9, new byte[0]);
    }

    private void writeFrame(int opcode, byte[] payload) {
        synchronized (writeLock) {
            if (!open || out == null) return;
            ByteArrayOutputStream frame = new ByteArrayOutputStream(payload.length + 10);
            frame.write(0x80 | opcode);
            int length = payload.length;
            if (length < 126) {
                frame.write(length);
            } else if (length <= 0xFFFF) {
                frame.write(126);
                frame.write((length >> 8) & 0xFF);
                frame.write(length & 0xFF);
            } else {
                frame.write(127);
                for (int shift = 56; shift >= 0; shift -= 8) {
                    frame.write((int) (((long) length >> shift) & 0xFF));
                }
            }
            frame.write(payload, 0, length);
            try {
                out.write(frame.toByteArray());
                out.flush();
            } catch (IOException err) {
                open = false;
                closeSocket();
            }
        }
    }

    /** A polite goodbye: a close frame, then the socket. */
    void close() {
        writeFrame(0x8, new byte[0]);
        open = false;
        closeSocket();
    }

    /** The heartbeat's answer to a peer that stopped existing: no frame, just the socket. */
    void terminate() {
        open = false;
        closeSocket();
    }

    private void closeSocket() {
        try {
            socket.close();
        } catch (IOException ignored) {
            // already closed
        }
    }
}
