// The relay's SD / HD seam, in process (P1-3 / P1-4 / P1-5).
//
// The browser filters its list and checks before it sends; the relay is the authority that a
// stale or hand-built client cannot talk its way past. `RelayCore` is Electron-free and
// socket-free on purpose (server/rooms.mjs), so this runs in milliseconds.

import { RelayCore } from "../server/rooms.mjs";

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
  if (!cond) failed++;
};

const conn = () => ({
  roomId: null,
  peerId: 0,
  sent: [],
  send(msg) { this.sent.push(msg); },
});
const last = (c, t) => [...c.sent].reverse().find((m) => m.t === t);
const clear = (c) => { c.sent.length = 0; };
const connect = (core) => {
  const c = conn();
  core.connect(c);
  clear(c); // hello + the empty list
  return c;
};

const core = new RelayCore();
const sd = connect(core);
const hd = connect(core);

console.log("a room is tagged with its line");
core.handle(sd, { t: "create", name: "SD Game", playerName: "A", mapName: "M", mapPath: "P", maxPlayers: 2 });
const sdRoom = last(sd, "created").room;
ok("SD is explicit, not inferred later", sdRoom.flavor === "sd");
ok("SD sends no build (the gate pins its data)", sdRoom.gameVersion === null);

core.handle(hd, { t: "create", name: "HD Game", playerName: "B", mapName: "M", mapPath: "P", maxPlayers: 2, flavor: "hd", gameVersion: "2.0.4" });
const hdRoom = last(hd, "created").room;
ok("HD keeps its exact build", hdRoom.flavor === "hd" && hdRoom.gameVersion === "2.0.4");

console.log("the listing can tell them apart");
const list = connect(core);
core.handle(list, { t: "list" });
const rooms = last(list, "rooms").rooms;
ok("both lines are listed", rooms.length === 2);
ok("each room names its line", rooms.map((r) => r.flavor).sort().join(",") === "hd,sd");

console.log("a join across lines is refused");
const sd2 = connect(core);
core.handle(sd2, { t: "join", roomId: hdRoom.id, playerName: "C" });
ok("an SD client cannot join an HD game", last(sd2, "error")?.message.includes("different version line"));
ok("…and is not seated", sd2.roomId === null);

console.log("an HD room needs the same build");
const old = connect(core);
core.handle(old, { t: "join", roomId: hdRoom.id, playerName: "D", flavor: "hd", gameVersion: "2.0.2" });
ok("a different HD build is refused", last(old, "error")?.message.includes("2.0.4"));
ok("…and is not seated", old.roomId === null);

const same = connect(core);
core.handle(same, { t: "join", roomId: hdRoom.id, playerName: "E", flavor: "hd", gameVersion: "2.0.4" });
ok("the same HD build joins", last(same, "joined")?.room.id === hdRoom.id);
ok("…and is seated", same.roomId === hdRoom.id);

console.log("the old line still works unchanged");
const sd3 = connect(core);
core.handle(sd3, { t: "join", roomId: sdRoom.id, playerName: "F" }); // no flavor = older client
ok("an older SD client joins an SD game", last(sd3, "joined")?.room.id === sdRoom.id);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("flavor relay: ok");
