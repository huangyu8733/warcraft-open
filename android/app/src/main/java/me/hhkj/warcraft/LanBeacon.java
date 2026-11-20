package me.hhkj.warcraft;

import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The phone's half of LAN discovery: the datagram {@code electron/beacon.mjs} already sends on
 * the desktop, sent and heard from the one place a page can never reach — the app's own process.
 *
 * <p>Same wire, same port, same rules, because the two shells must find EACH OTHER: a broadcast
 * carries nothing but "an Warcraft Open speaking protocol N has its relay on port P", and the
 * page then knocks on that address with the ordinary relay handshake ({@code
 * src/net/lobby.ts addRelay}). No game state travels in a datagram, and nothing here is believed
 * beyond an address to try.
 *
 * <p>Announcing runs while the app runs, not only while a game is hosted, exactly as on the
 * desktop: the other machine is already being watched when somebody creates a game there, so
 * the list fills in the moment it appears instead of a beat later.
 */
final class LanBeacon {
    private static final String TAG = "WarcraftOpen";
    /** MUST equal {@code DEFAULT_BEACON_PORT} in electron/beacon.mjs — the desktop listens here. */
    static final int PORT = 8788;
    private static final long INTERVAL_MS = 2000L;
    /** A peer unheard for three beats is gone: a closed app, a pulled cable. */
    private static final long FORGET_MS = INTERVAL_MS * 3;

    /** A machine we can hear, as the bridge's `{id,url}` (`src/assets/nativeInstall.ts`). */
    static final class Peer {
        final String id;
        final String url;

        Peer(String id, String url) {
            this.id = id;
            this.url = url;
        }
    }

    /** Ours, so our own datagrams — which come back on every interface — are ignored. */
    private final String id = UUID.randomUUID().toString();
    private final LanRelay relay;
    private final ConcurrentHashMap<String, Seen> peers = new ConcurrentHashMap<>();

    private volatile boolean running;
    private DatagramSocket socket;
    private Thread thread;

    LanBeacon(LanRelay relay) {
        this.relay = relay;
    }

    private static final class Seen {
        final String url;
        final long at;

        Seen(String url, long at) {
            this.url = url;
            this.at = at;
        }
    }

    /** Bind, then beat and listen on one thread — a receive timeout is the tick. */
    void start() {
        try {
            DatagramSocket bound = new DatagramSocket(null);
            bound.setReuseAddress(true);
            bound.setBroadcast(true);
            bound.bind(new InetSocketAddress(PORT));
            // Short enough that the beat is never later than a bit, long enough to idle cheaply.
            bound.setSoTimeout(500);
            socket = bound;
        } catch (Exception err) {
            // A firewall or a port already taken is not a reason to fail to start a GAME: the
            // address box still exists. Report it and carry on, as the desktop does.
            Log.w(TAG, "beacon unavailable", err);
            return;
        }
        running = true;
        thread = new Thread(this::loop, "lan-beacon");
        thread.start();
    }

    void stop() {
        running = false;
        DatagramSocket open = socket;
        socket = null;
        if (open != null) {
            try {
                open.close();
            } catch (RuntimeException ignored) {
                // already gone
            }
        }
    }

    /** Every machine heard in the last few beats. Expiry happens here so a caller never sees one. */
    List<Peer> peers() {
        long cutoff = System.currentTimeMillis() - FORGET_MS;
        Set<String> urls = new LinkedHashSet<>();
        List<Peer> out = new ArrayList<>();
        for (java.util.Map.Entry<String, Seen> entry : peers.entrySet()) {
            Seen seen = entry.getValue();
            if (seen.at < cutoff) {
                peers.remove(entry.getKey());
                continue;
            }
            if (urls.add(seen.url)) out.add(new Peer(entry.getKey(), seen.url));
        }
        return out;
    }

    private void loop() {
        byte[] buffer = new byte[512];
        long next = 0L;
        while (running) {
            long now = System.currentTimeMillis();
            if (now >= next) {
                announce();
                next = now + INTERVAL_MS;
            }
            try {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                socket.receive(packet);
                heard(packet);
            } catch (SocketTimeoutException ignored) {
                // No datagram this half second; the beat at the top of the loop is what matters.
            } catch (Exception err) {
                if (running) Log.w(TAG, "beacon receive failed", err);
                return;
            }
        }
    }

    private void announce() {
        if (socket == null) return;
        int port = relay.port();
        // The relay binds a moment after the activity starts; asking each beat means the first
        // usable one is announced the instant it is known, never a stale number.
        if (port <= 0) return;
        byte[] payload = ("{\"app\":\"warcraft-open\",\"protocol\":" + LanRelay.PROTOCOL_VERSION
                + ",\"id\":\"" + id + "\",\"port\":" + port + "}").getBytes(StandardCharsets.UTF_8);
        for (InetAddress target : broadcastAddresses()) {
            try {
                socket.send(new DatagramPacket(payload, payload.length, target, PORT));
            } catch (IOException ignored) {
                // One lost beat is one lost beat.
            }
        }
    }

    /**
     * Every directed broadcast address, one per IPv4 interface, plus the limited one.
     *
     * <p>Not just 255.255.255.255 for the same reason as the desktop's copy: plenty of stacks
     * refuse to route the limited broadcast out of a chosen interface, so a phone on wifi and
     * hotspot at once would shout down only one of them.
     */
    private static List<InetAddress> broadcastAddresses() {
        Set<InetAddress> out = new LinkedHashSet<>();
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
        } catch (Exception ignored) {
            // no DNS, no limited broadcast; the per-interface ones below are the real answer
        }
        try {
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                for (InterfaceAddress entry : nic.getInterfaceAddresses()) {
                    InetAddress broadcast = entry.getBroadcast();
                    if (broadcast != null && broadcast instanceof Inet4Address) out.add(broadcast);
                }
            }
        } catch (Exception ignored) {
            // no interfaces to enumerate: the limited broadcast is all we have
        }
        return new ArrayList<>(out);
    }

    private void heard(DatagramPacket packet) {
        if (packet.getLength() <= 0 || packet.getLength() > 1024) return;
        JSONObject msg;
        try {
            msg = new JSONObject(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
        } catch (Exception err) {
            return; // somebody else's traffic on a port we happen to share
        }
        if (!"warcraft-open".equals(msg.optString("app"))) return;
        // A build on another protocol would be refused at the relay's handshake anyway; dropping
        // it here means it is never listed, rather than listed and unjoinable.
        if (msg.optInt("protocol", -1) != LanRelay.PROTOCOL_VERSION) return;
        String peerId = msg.optString("id", "");
        int port = msg.optInt("port", 0);
        if (peerId.isEmpty() || peerId.equals(id) || port <= 0 || port > 65535) return;
        InetAddress from = packet.getAddress();
        if (from == null || from.isLoopbackAddress()) return;
        String host = from.getHostAddress();
        if (host == null || host.isEmpty()) return;
        peers.put(peerId, new Seen("ws://" + host + ":" + port + "/relay", System.currentTimeMillis()));
    }
}
