package me.hhkj.warcraft;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * The relay's actual logic — rooms, peers and message routing — with no socket in sight.
 *
 * <p>A line-for-line port of {@code server/rooms.mjs}, which is the authority for every rule
 * here. The split is that file's own: this class never sees bytes, and {@link WsConnection}
 * never sees rooms. Keeping the two apart is what lets this be diffed against the Node
 * implementation by reading them side by side.
 *
 * <p>The relay stays deliberately dumb: a room table and a forwards desk. It never simulates,
 * never inspects {@code relay.data}, and holds no match state.
 *
 * <p>Every public method is {@code synchronized}. Callers are the per-connection reader threads
 * and the scheduled hold timer, so the room table has one lock rather than a scheme.
 */
final class RelayCore {
    /** The one literal lives in {@link LanRelay}, beside the class tools/relay-test.mjs reads. */
    static final int PROTOCOL_VERSION = LanRelay.PROTOCOL_VERSION;
    /** How long a DROPPED player's slot is held before the drop becomes a leave. */
    static final long HOLD_MS = 120_000L;
    /** MUST equal {@code DROPPED_MESSAGE} in src/net/protocol.ts. */
    static final String DROPPED = "You were dropped from the game.";

    /** A connection, as this class uses it: something that can be sent a message. */
    interface Conn {
        void send(JSONObject msg);
    }

    /** Asked per connection what this machine looks like from the network (HostInfo). */
    interface DescribeHost {
        JSONObject describe();
    }

    private static final class Session {
        String roomId;
        int peerId;
    }

    private static final class Peer {
        int id = 0;
        String name = "";
        boolean host = false;
        Conn conn = null;
        String token = "";
        boolean disconnected = false;
        long droppedAt = 0;
        ScheduledFuture<?> dropTimer = null;
    }

    private static final class Room {
        String id = "";
        String name = "";
        String hostName = "";
        String mapName = "";
        String mapPath = "";
        int maxPlayers = 12;
        boolean observers = false;
        String edition = "tft";
        String flavor = "sd";
        String gameVersion = null;
        int speed = 2;
        final Map<Integer, Peer> peers = new LinkedHashMap<>();
        int nextPeerId = 2;
    }

    private final Map<String, Room> rooms = new LinkedHashMap<>();
    private final Map<Conn, Session> sessions = new IdentityHashMap<>();
    private final ScheduledExecutorService timer;
    private final DescribeHost describeHost;
    private final long holdMs;
    private long nextRoomId = 1;

    RelayCore(ScheduledExecutorService timer, DescribeHost describeHost, long holdMs) {
        this.timer = timer;
        this.describeHost = describeHost;
        this.holdMs = holdMs;
    }

    // ── the table, as JSON ────────────────────────────────────────────────────────────────

    private static void put(JSONObject o, String key, Object value) {
        try {
            o.put(key, value == null ? JSONObject.NULL : value);
        } catch (Exception err) {
            throw new IllegalStateException(err);
        }
    }

    private static JSONObject message(String type) {
        JSONObject o = new JSONObject();
        put(o, "t", type);
        return o;
    }

    private static JSONObject error(String text) {
        JSONObject o = message("error");
        put(o, "message", text);
        return o;
    }

    private static JSONObject peerInfo(Peer p) {
        JSONObject o = new JSONObject();
        put(o, "id", p.id);
        put(o, "name", p.name);
        put(o, "host", p.host);
        return o;
    }

    private static JSONObject roomInfo(Room r) {
        JSONObject o = new JSONObject();
        put(o, "id", r.id);
        put(o, "name", r.name);
        put(o, "hostName", r.hostName);
        put(o, "mapName", r.mapName);
        put(o, "mapPath", r.mapPath);
        put(o, "players", r.peers.size());
        put(o, "maxPlayers", r.maxPlayers);
        put(o, "observers", r.observers);
        put(o, "edition", r.edition);
        put(o, "speed", r.speed);
        put(o, "flavor", r.flavor);
        put(o, "gameVersion", r.gameVersion);
        return o;
    }

    private List<JSONObject> listing() {
        List<JSONObject> out = new ArrayList<>(rooms.size());
        for (Room r : rooms.values()) out.add(roomInfo(r));
        return out;
    }

    private JSONObject roomsMessage() {
        JSONObject o = message("rooms");
        JSONArray arr = new JSONArray();
        for (JSONObject one : listing()) arr.put(one);
        put(o, "rooms", arr);
        return o;
    }

    /** Push the game list to everyone not already in a room. */
    private void broadcastRooms() {
        JSONObject msg = roomsMessage();
        for (Map.Entry<Conn, Session> entry : sessions.entrySet()) {
            if (entry.getValue().roomId == null) entry.getKey().send(msg);
        }
    }

    private void inRoom(Room room, JSONObject msg, int exceptId) {
        for (Peer p : room.peers.values()) {
            if (p.id != exceptId && p.conn != null) p.conn.send(msg);
        }
    }

    private Session sessionOf(Conn conn) {
        Session s = sessions.get(conn);
        if (s == null) {
            s = new Session();
            sessions.put(conn, s);
        }
        return s;
    }

    // ── connections ──────────────────────────────────────────────────────────────────────

    /** Handshake and the current game list, in that order. */
    synchronized void connect(Conn conn) {
        sessions.put(conn, new Session());
        JSONObject hello = message("hello");
        put(hello, "protocol", PROTOCOL_VERSION);
        JSONObject host = describeHost == null ? null : describeHost.describe();
        if (host != null) put(hello, "host", host);
        conn.send(hello);
        conn.send(roomsMessage());
    }

    /**
     * The connection DROPPED. A drop is not a leave: a non-host slot is HELD for its token.
     * The host is the exception (no host migration), as is a room left with nobody live.
     */
    synchronized void disconnect(Conn conn) {
        Session session = sessions.remove(conn);
        if (session == null) return;
        Room room = rooms.get(session.roomId);
        if (room == null) return;
        Peer peer = room.peers.get(session.peerId);
        session.roomId = null;
        if (peer == null) return;

        boolean anyLive = false;
        for (Peer p : room.peers.values()) {
            if (p != peer && !p.disconnected) {
                anyLive = true;
                break;
            }
        }
        if (peer.host || !anyLive) {
            inRoom(room, closedMessage(peer.host ? "The host left the game." : "Empty."), 0);
            for (Peer p : room.peers.values()) {
                if (p.conn != null) {
                    Session s = sessions.get(p.conn);
                    if (s != null) s.roomId = null;
                }
            }
            rooms.remove(room.id);
            broadcastRooms();
            return;
        }

        peer.disconnected = true;
        peer.conn = null;
        peer.droppedAt = System.currentTimeMillis();
        JSONObject drop = message("peer-drop");
        put(drop, "peerId", peer.id);
        put(drop, "holdMs", holdMs);
        inRoom(room, drop, peer.id);
        broadcastRooms();

        clearTimer(peer);
        final String roomId = room.id;
        final int peerId = peer.id;
        peer.dropTimer = timer.schedule(() -> expireHold(roomId, peerId), holdMs, TimeUnit.MILLISECONDS);
    }

    private static JSONObject closedMessage(String reason) {
        JSONObject o = message("room-closed");
        put(o, "reason", reason);
        return o;
    }

    /** The hold ran out: let the seat go exactly as a chosen leave would. */
    private synchronized void expireHold(String roomId, int peerId) {
        Room room = rooms.get(roomId);
        if (room == null) return;
        Peer peer = room.peers.get(peerId);
        if (peer == null || !peer.disconnected) return;
        peer.dropTimer = null;
        room.peers.remove(peer.id);
        boolean anyLive = false;
        for (Peer p : room.peers.values()) {
            if (!p.disconnected) {
                anyLive = true;
                break;
            }
        }
        if (!anyLive) {
            rooms.remove(room.id);
        } else {
            JSONObject leave = message("peer-leave");
            put(leave, "peerId", peer.id);
            inRoom(room, leave, 0);
        }
        broadcastRooms();
    }

    /** A CHOSEN departure. Frees the slot at once — the opposite of a drop. */
    private synchronized void leaveRoom(Conn conn) {
        Session session = sessions.get(conn);
        if (session == null) return;
        Room room = rooms.get(session.roomId);
        if (room == null) return;
        Peer peer = room.peers.remove(session.peerId);
        session.roomId = null;

        if (peer != null && (peer.host || room.peers.isEmpty())) {
            inRoom(room, closedMessage(peer.host ? "The host left the game." : "Empty."), 0);
            for (Peer p : room.peers.values()) {
                if (p.conn != null) {
                    Session s = sessions.get(p.conn);
                    if (s != null) s.roomId = null;
                }
            }
            rooms.remove(room.id);
        } else {
            JSONObject leave = message("peer-leave");
            put(leave, "peerId", session.peerId);
            inRoom(room, leave, 0);
        }
        broadcastRooms();
    }

    // ── messages ────────────────────────────────────────────────────────────────────────

    /** One already-parsed client message. */
    synchronized void handle(Conn conn, JSONObject msg) {
        Session session = sessionOf(conn);
        String type = msg.optString("t", "");
        switch (type) {
            case "list":
                conn.send(roomsMessage());
                return;

            case "create": {
                if (session.roomId != null) {
                    conn.send(error("Already in a game."));
                    return;
                }
                Peer peer = new Peer();
                peer.id = 1;
                peer.name = nonEmpty(msg.optString("playerName", ""), "Player");
                peer.host = true;
                peer.conn = conn;
                peer.token = UUID.randomUUID().toString();

                Room room = new Room();
                room.id = String.valueOf(nextRoomId++);
                room.name = nonEmpty(msg.optString("name", ""), "Warcraft Open Game");
                room.hostName = peer.name;
                room.mapName = msg.optString("mapName", "");
                room.mapPath = msg.optString("mapPath", "");
                int max = msg.optInt("maxPlayers", 0);
                if (max == 0) max = 12;
                room.maxPlayers = Math.max(2, Math.min(12, max));
                room.observers = msg.optBoolean("observers", false);
                room.edition = "roc".equals(msg.optString("edition", "")) ? "roc" : "tft";
                room.flavor = "hd".equals(msg.optString("flavor", "")) ? "hd" : "sd";
                String version = msg.optString("gameVersion", "");
                room.gameVersion = version.isEmpty() ? null : version;
                room.speed = speedOf(msg);
                room.peers.put(peer.id, peer);

                rooms.put(room.id, room);
                session.roomId = room.id;
                session.peerId = peer.id;

                JSONObject created = message("created");
                put(created, "room", roomInfo(room));
                put(created, "you", peerInfo(peer));
                put(created, "token", peer.token);
                conn.send(created);
                broadcastRooms();
                return;
            }

            case "join": {
                if (session.roomId != null) {
                    conn.send(error("Already in a game."));
                    return;
                }
                Room room = rooms.get(msg.optString("roomId", ""));
                if (room == null) {
                    conn.send(error("That game is no longer available."));
                    return;
                }
                String line = "hd".equals(msg.optString("flavor", "")) ? "hd" : "sd";
                if (!line.equals(room.flavor == null ? "sd" : room.flavor)) {
                    conn.send(error("That game is on a different version line (SD/HD)."));
                    return;
                }
                if ("hd".equals(room.flavor)) {
                    String asked = msg.optString("gameVersion", "");
                    if (asked.isEmpty()) asked = null;
                    boolean same = asked == null ? room.gameVersion == null : asked.equals(room.gameVersion);
                    if (!same) {
                        conn.send(error("That game needs Reforged "
                                + (room.gameVersion == null ? "another build" : room.gameVersion) + "."));
                        return;
                    }
                }

                String token = msg.optString("token", "");
                Peer held = null;
                if (!token.isEmpty()) {
                    for (Peer p : room.peers.values()) {
                        if (p.disconnected && token.equals(p.token)) {
                            held = p;
                            break;
                        }
                    }
                }
                if (held != null) {
                    clearTimer(held);
                    held.conn = conn;
                    held.disconnected = false;
                    String name = msg.optString("playerName", "");
                    if (!name.isEmpty()) held.name = name;
                    session.roomId = room.id;
                    session.peerId = held.id;

                    JSONObject joined = message("joined");
                    put(joined, "room", roomInfo(room));
                    put(joined, "you", peerInfo(held));
                    put(joined, "peers", allPeers(room));
                    put(joined, "token", held.token);
                    conn.send(joined);

                    JSONObject rejoin = message("peer-rejoin");
                    put(rejoin, "peer", peerInfo(held));
                    inRoom(room, rejoin, held.id);
                    broadcastRooms();
                    return;
                }

                if (!token.isEmpty()) {
                    conn.send(error(DROPPED));
                    return;
                }
                if (room.peers.size() >= room.maxPlayers) {
                    conn.send(error("That game is full."));
                    return;
                }
                Peer peer = new Peer();
                peer.id = room.nextPeerId++;
                peer.name = nonEmpty(msg.optString("playerName", ""), "Player");
                peer.host = false;
                peer.conn = conn;
                peer.token = UUID.randomUUID().toString();
                room.peers.put(peer.id, peer);
                session.roomId = room.id;
                session.peerId = peer.id;

                JSONObject joined = message("joined");
                put(joined, "room", roomInfo(room));
                put(joined, "you", peerInfo(peer));
                put(joined, "peers", allPeers(room));
                put(joined, "token", peer.token);
                conn.send(joined);

                JSONObject arrived = message("peer-join");
                put(arrived, "peer", peerInfo(peer));
                inRoom(room, arrived, peer.id);
                broadcastRooms();
                return;
            }

            case "leave":
                leaveRoom(conn);
                return;

            case "seat": {
                Room room = rooms.get(msg.optString("roomId", ""));
                String token = msg.optString("token", "");
                Peer seat = findHeld(room, token);
                long left = seat == null ? 0 : Math.max(0, seat.droppedAt + holdMs - System.currentTimeMillis());
                JSONObject answer = message("seat");
                put(answer, "held", seat != null);
                put(answer, "left", left);
                conn.send(answer);
                return;
            }

            case "abandon": {
                Room room = rooms.get(msg.optString("roomId", ""));
                Peer held = findHeld(room, msg.optString("token", ""));
                if (held == null) return;
                clearTimer(held);
                room.peers.remove(held.id);
                boolean anyLive = false;
                for (Peer p : room.peers.values()) {
                    if (!p.disconnected) {
                        anyLive = true;
                        break;
                    }
                }
                if (anyLive) {
                    JSONObject leave = message("peer-leave");
                    put(leave, "peerId", held.id);
                    inRoom(room, leave, 0);
                } else {
                    rooms.remove(room.id);
                }
                broadcastRooms();
                return;
            }

            case "drop": {
                Room room = rooms.get(session.roomId);
                if (room == null) return;
                Peer me = room.peers.get(session.peerId);
                if (me == null || !me.host) return;
                Peer held = room.peers.get(msg.optInt("peerId", -1));
                if (held == null || !held.disconnected) return;
                clearTimer(held);
                room.peers.remove(held.id);
                JSONObject leave = message("peer-leave");
                put(leave, "peerId", held.id);
                inRoom(room, leave, 0);
                broadcastRooms();
                return;
            }

            case "relay": {
                Room room = rooms.get(session.roomId);
                if (room == null) {
                    conn.send(error("Not in a game."));
                    return;
                }
                JSONObject out = message("deliver");
                put(out, "from", session.peerId);
                if (msg.has("data")) put(out, "data", msg.opt("data"));
                Object to = msg.opt("to");
                if (to instanceof Number) {
                    Peer target = room.peers.get(((Number) to).intValue());
                    // A held slot has no live connection: silence is the right answer.
                    if (target != null && target.conn != null) target.conn.send(out);
                } else {
                    inRoom(room, out, session.peerId);
                }
                return;
            }

            default:
                conn.send(error("Unknown message: " + type));
        }
    }

    private static JSONArray allPeers(Room room) {
        JSONArray arr = new JSONArray();
        for (Peer p : room.peers.values()) arr.put(peerInfo(p));
        return arr;
    }

    private static Peer findHeld(Room room, String token) {
        if (room == null || token.isEmpty()) return null;
        for (Peer p : room.peers.values()) {
            if (p.disconnected && token.equals(p.token)) return p;
        }
        return null;
    }

    private static String nonEmpty(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    /** 0 Slow … 3 Fastest; anything else (an older client's silence) is Fast, 2. */
    private static int speedOf(JSONObject msg) {
        Object raw = msg.opt("speed");
        if (raw instanceof Number) {
            double value = ((Number) raw).doubleValue();
            if (value == Math.rint(value) && value >= 0 && value <= 3) return (int) value;
        }
        return 2;
    }

    private static void clearTimer(Peer peer) {
        ScheduledFuture<?> timer = peer.dropTimer;
        peer.dropTimer = null;
        if (timer != null) timer.cancel(false);
    }

    /** The activity is going away: every held seat's timer ends with it. */
    synchronized void shutdown() {
        for (Room room : rooms.values()) {
            for (Peer p : room.peers.values()) clearTimer(p);
        }
        rooms.clear();
        sessions.clear();
    }
}
