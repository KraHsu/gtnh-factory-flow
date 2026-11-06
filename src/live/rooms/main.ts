import path from "node:path";
import { ROOM_PROTOCOL } from "@/lib/rooms/types";
import { LiveService } from "../service";
import { createRoomHttp } from "./http";
import { RoomStore } from "./store";

const directory = process.env.GTNH_ROOMS_DIR;
if (!directory || !path.isAbsolute(directory))
  throw new Error("GTNH_ROOMS_DIR must be an absolute data directory.");
const origins = (process.env.LIVE_ALLOWED_ORIGINS ?? "https://gtnh.krahsu.top")
  .split(",")
  .map((value) => value.trim());
const store = new RoomStore(path.join(directory, "rooms.sqlite3"));
const http = createRoomHttp({
  store,
  origins,
  refreshMembers: (doc) => service.refreshMembers(doc),
  dropDocument: (doc) => service.dropDocument(doc),
});
const service = new LiveService({
  store: store.planStore(),
  journalDir: path.join(directory, "journal"),
  allowedOrigins: origins,
  limits: { maxRooms: 20, roomsPerAccount: 1, roomsPerConnection: 1, flushConcurrency: 2 },
  authenticate: async (request) => {
    const protocols = (request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((value) => value.trim());
    if (protocols.length !== 2 || protocols[0] !== ROOM_PROTOCOL) return undefined;
    const guest = store.guest(protocols[1]);
    return guest ? { id: guest.id as string, username: guest.nickname as string } : undefined;
  },
  httpHandler: http,
});

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void service.stop().then(() => {
      store.close();
      process.exit(0);
    });
  });
void service
  .start(Number(process.env.GTNH_ROOMS_PORT ?? 8793), "127.0.0.1")
  .then((port) => console.log(`[rooms] listening on 127.0.0.1:${port}`))
  .catch((error) => {
    console.error("[rooms] startup failed", error);
    store.close();
    process.exit(1);
  });
