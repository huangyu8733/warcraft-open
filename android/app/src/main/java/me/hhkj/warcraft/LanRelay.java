package me.hhkj.warcraft;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * The relay this app carries: a listening socket, a set of connections, and the addresses the
 * page is told about.
 *
 * <p>This is the Android counterpart of the two pieces the desktop has — {@code server/relay.mjs}
 * (the port) and {@code server/hostInfo.mjs} (what "this machine" is called on the network) —
 * with {@link RelayCore} and {@link WsConnection} doing the other two jobs. The relay lives as
 * long as the activity: closed with the app, like the desktop's is closed with its window.
 *
 * <p>It listens on every interface (`0.0.0.0`) so a phone in hotspot mode works with no router
 * at all, and it enumerates its addresses on demand, because a Wi-Fi change can move the URL
 * while the game sits on the menu.
 */
final class LanRelay {
    private static final String TAG = "WarcraftOpen";
    /**
     * MUST equal {@code PROTOCOL_VERSION} in src/net/protocol.ts and server/rooms.mjs. This is
     * the third copy, and tools/relay-test.mjs compares all three.
     */
    static final int PROTOCOL_VERSION = 14;
    /** Same port as the desktop relay, so a player has one number to remember. */
    private static final int FIRST_PORT = 8787;
    private static final int LAST_PORT = 8797;
    /** Same sweep as wsAdapter.mjs: a peer that ignores two pings is gone. */
    private static final long HEARTBEAT_MS = 15_000L;

    private final RelayCore core;
    private final Set<WsConnection> connections = ConcurrentHashMap.newKeySet();
    private final ScheduledExecutorService scheduler;
    private final WsConnection.Listener listener = new WsConnection.Listener() {
        @Override
        public void onOpen(WsConnection conn) {
            connections.add(conn);
            core.connect(conn);
        }

        @Override
        public void onText(WsConnection conn, String text) {
            JSONObject msg;
            try {
                msg = new JSONObject(text);
            } catch (Exception err) {
                // A parse failure is a WIRE fault, answered here rather than by the core.
                malformed(conn);
                return;
            }
            core.handle(conn, msg);
        }

        @Override
        public void onClose(WsConnection conn) {
            connections.remove(conn);
            core.disconnect(conn);
        }
    };

    private volatile ServerSocket server;
    private volatile int port = 0;
    private volatile boolean running = false;

    LanRelay() {
        ScheduledThreadPoolExecutor pool = new ScheduledThreadPoolExecutor(2, runnable -> {
            Thread thread = new Thread(runnable, "lan-relay-timer");
            thread.setDaemon(true);
            return thread;
        });
        scheduler = pool;
        core = new RelayCore(scheduler, this::hostInfo, RelayCore.HOLD_MS);
    }

    /** The bound port, or 0 before {@link #start} has finished binding. */
    int port() {
        return port;
    }

    /**
     * Bind and serve. Call on a background thread: the accept loop is this call's life.
     */
    void start() {
        if (running) return;
        ServerSocket bound = bind();
        if (bound == null) {
            Log.w(TAG, "lan relay could not bind a port; LAN hosting is off");
            return;
        }
        server = bound;
        port = bound.getLocalPort();
        running = true;
        Log.i(TAG, "relay listening on " + port);

        scheduler.scheduleAtFixedRate(this::heartbeat, HEARTBEAT_MS, HEARTBEAT_MS, TimeUnit.MILLISECONDS);
        try {
            while (running) {
                Socket socket = bound.accept();
                new WsConnection(socket, listener).start();
            }
        } catch (IOException err) {
            if (running) Log.w(TAG, "lan relay accept failed", err);
        }
    }

    /** The activity is going away: the port and every room go with it. */
    void stop() {
        running = false;
        ServerSocket closing = server;
        server = null;
        if (closing != null) {
            try {
                closing.close();
            } catch (IOException ignored) {
                // already closed
            }
        }
        for (WsConnection conn : connections) conn.terminate();
        connections.clear();
        core.shutdown();
        scheduler.shutdownNow();
        port = 0;
    }

    /** 8787, then up to 8797, then whatever the system hands out. */
    private static ServerSocket bind() {
        for (int candidate = FIRST_PORT; candidate <= LAST_PORT; candidate++) {
            ServerSocket bound = tryBind(candidate);
            if (bound != null) return bound;
        }
        return tryBind(0);
    }

    private static ServerSocket tryBind(int candidate) {
        ServerSocket socket = null;
        try {
            socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress("0.0.0.0", candidate));
            return socket;
        } catch (IOException err) {
            if (socket != null) {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    // nothing to close
                }
            }
            return null;
        }
    }

    /** Same sweep as wsAdapter.mjs: heartbeat, and terminate whoever ignored the last one. */
    private void heartbeat() {
        for (WsConnection conn : connections) {
            if (conn.awaitingPong()) {
                conn.terminate();
            } else {
                conn.expectPong();
                conn.ping();
            }
        }
    }

    /**
     * This machine on the network, as {@code HostInfo} (src/net/protocol.ts): non-loopback IPv4
     * addresses with the port, e.g. {@code "192.168.1.5:8787"}. Asked per connection, so a new
     * handshake after a Wi-Fi change carries the new address.
     */
    JSONObject hostInfo() {
        JSONObject out = new JSONObject();
        JSONArray addresses = new JSONArray();
        try {
            for (String address : addresses()) addresses.put(address);
            out.put("kind", "app");
            out.put("lan", true);
            out.put("addresses", addresses);
        } catch (Exception err) {
            Log.w(TAG, "cannot describe host", err);
        }
        return out;
    }

    /** Every address a player on this network could dial, {@code ip:port}. */
    List<String> addresses() {
        int boundPort = port;
        if (boundPort <= 0) return Collections.emptyList();
        Set<String> out = new LinkedHashSet<>();
        try {
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                for (InterfaceAddress entry : nic.getInterfaceAddresses()) {
                    InetAddress address = entry.getAddress();
                    if (address instanceof Inet4Address
                            && !address.isLoopbackAddress()
                            && !address.isLinkLocalAddress()) {
                        out.add(address.getHostAddress() + ":" + boundPort);
                    }
                }
            }
        } catch (Exception err) {
            Log.w(TAG, "cannot list network addresses", err);
        }
        // No Wi-Fi and no hotspot: the phone can still host for itself, and saying so beats an
        // empty list that reads as "broken".
        if (out.isEmpty()) out.add("127.0.0.1:" + boundPort);
        return new ArrayList<>(out);
    }

    /** The same addresses as URLs the page can dial ({@code ws://…/relay}). */
    List<String> urls() {
        List<String> out = new ArrayList<>();
        for (String address : addresses()) out.add("ws://" + address + "/relay");
        return out;
    }

    private static void malformed(WsConnection conn) {
        JSONObject msg = new JSONObject();
        try {
            msg.put("t", "error");
            msg.put("message", "Malformed message.");
        } catch (Exception ignored) {
            // two constant keys; nothing can fail here
        }
        conn.send(msg);
    }
}
