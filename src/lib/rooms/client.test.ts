import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesignSummary } from "@/lib/designs/design-library";
import { createEmptyProject } from "@/examples";
import type { RoomAdmission } from "./types";
import {
  REMEMBERED_ROOMS_KEY,
  ROOM_STORAGE_KEY,
  TAB_ROOMS_KEY,
  rememberRoomConnection,
  savedRoomConnections,
  useRoomConnection,
  type RoomConnection,
} from "./connection";
import { enterRoom, restoreRoom, leaveRoom } from "./client";

const designs = vi.hoisted(() => ({
  activeDesignId: undefined as string | undefined,
  designs: [] as DesignSummary[],
  openSharedDesign: vi.fn(),
}));
vi.mock("@/store/design-store", () => ({
  useDesignStore: { getState: () => designs },
  sharedDesignLocalId: (ref: { ownerId: string; designId: string }) =>
    `shared-${ref.ownerId}-${ref.designId}`,
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}
function admission(code = "12345678", expiresAt: number | null = null): RoomAdmission {
  return {
    room: {
      code,
      name: `Room ${code}`,
      ownerId: "owner",
      ownerName: "房主",
      designId: code,
      createdAt: "2026-11-08T00:00:00Z",
      updatedAt: "2026-11-08T00:00:00Z",
    },
    user: { id: code, username: "记住的昵称" },
    token: code.padEnd(43, "a"),
    expiresAt,
    plan: createEmptyProject(),
  };
}
function connection(value = admission()): RoomConnection {
  const { plan, ...credentials } = value;
  void plan;
  return { ...credentials, designId: `shared-owner-${value.room.designId}` };
}
function activate(value: RoomConnection) {
  designs.activeDesignId = value.designId;
  if (!designs.designs.some((design) => design.id === value.designId))
    designs.designs.push({
      id: value.designId,
      name: value.room.name,
      createdAt: "",
      updatedAt: "",
      cloud: value.room,
    });
}
function reply(value: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => value } as Response;
}
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => reply(admission())),
  );
  designs.activeDesignId = undefined;
  designs.designs = [];
  designs.openSharedDesign.mockReset().mockImplementation(async (ref) => {
    activate(connection(admission(ref.designId)));
    return true;
  });
  useRoomConnection.setState({ connection: undefined, saved: [], dialog: undefined });
});
afterEach(() => vi.unstubAllGlobals());

it("remembers the scoped admission and nickname, then restores the same room before a network response after browser restart", async () => {
  await enterRoom(admission());
  expect(JSON.parse(localStorage.getItem(REMEMBERED_ROOMS_KEY)!)[0]).toMatchObject({
    user: { username: "记住的昵称" },
  });
  sessionStorage.clear();
  useRoomConnection.setState({ connection: undefined, saved: [] });
  let respond!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const restoring = restoreRoom();
  expect(useRoomConnection.getState().connection?.token).toBe(admission().token);
  expect(designs.openSharedDesign).toHaveBeenCalledTimes(1);
  respond(reply(admission()));
  await restoring;
  expect(designs.designs).toHaveLength(1);
  expect(designs.activeDesignId).toBe(connection().designId);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
    token: admission().token,
  });
});

it("keeps remembered rooms independent and ignores a late rejection while another room is open", async () => {
  const a = connection(),
    b = connection(admission("23456789"));
  rememberRoomConnection(a);
  rememberRoomConnection(b);
  activate(a);
  let rejectA!: (value: Response) => void;
  vi.mocked(fetch)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          rejectA = resolve;
        }),
    )
    .mockResolvedValueOnce(reply(admission("23456789")));
  const old = restoreRoom();
  activate(b);
  await restoreRoom();
  rejectA(reply({ error: "expired" }, 401));
  await old;
  expect(useRoomConnection.getState().connection?.token).toBe(b.token);
  expect(savedRoomConnections()).toEqual([b]);
  expect(useRoomConnection.getState().dialog).toBeUndefined();
});

it("keeps the offline connection and cached room identity when the server cannot be reached", async () => {
  const room = connection();
  rememberRoomConnection(room);
  activate(room);
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  await restoreRoom();
  expect(useRoomConnection.getState().connection).toEqual(room);
  expect(savedRoomConnections()).toEqual([room]);
  expect(designs.designs[0].cloud?.designId).toBe(room.room.designId);
});

it("does not erase a newly opened room when a leave request for the previous room finishes late", async () => {
  const a = connection(),
    b = connection(admission("23456789"));
  rememberRoomConnection(a);
  useRoomConnection.setState({ connection: a });
  let respond!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const leaving = leaveRoom();
  rememberRoomConnection(b);
  useRoomConnection.setState({ connection: b });
  respond(reply({ ok: true }));
  await leaving;
  expect(useRoomConnection.getState().connection).toEqual(b);
  expect(savedRoomConnections()).toEqual([b]);
});

it("restores only the selected room and never replaces an unrelated local plan", async () => {
  rememberRoomConnection(connection());
  designs.activeDesignId = "local";
  designs.designs = [{ id: "local", name: "Local", createdAt: "", updatedAt: "" }];
  await restoreRoom();
  expect(fetch).not.toHaveBeenCalled();
  expect(designs.activeDesignId).toBe("local");
  expect(useRoomConnection.getState().connection).toBeUndefined();
});

it("migrates a valid old tab admission without opening a duplicate design", async () => {
  activate(connection());
  sessionStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({ token: admission().token }));
  await restoreRoom();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
    token: admission().token,
    remember: true,
  });
  expect(useRoomConnection.getState().connection?.user.username).toBe("记住的昵称");
  expect(savedRoomConnections()).toEqual([connection()]);
  expect(sessionStorage.getItem(ROOM_STORAGE_KEY)).toBeNull();
  expect(designs.openSharedDesign).not.toHaveBeenCalled();
});

it("stores opted-out access only in the tab and revokes just the room explicitly forgotten", async () => {
  const other = connection(admission("23456789"));
  rememberRoomConnection(other);
  await enterRoom(admission("12345678", Date.now() + 60_000));
  expect(JSON.parse(localStorage.getItem(REMEMBERED_ROOMS_KEY)!)).toEqual([other]);
  expect(JSON.parse(sessionStorage.getItem(TAB_ROOMS_KEY)!)).toHaveLength(1);
  await leaveRoom();
  expect(savedRoomConnections()).toEqual([other]);
  expect(useRoomConnection.getState().connection).toBeUndefined();
  expect(designs.designs).toHaveLength(1);
});

it("ignores broken browser storage without blocking the planner", async () => {
  localStorage.setItem(REMEMBERED_ROOMS_KEY, "{broken");
  sessionStorage.setItem(TAB_ROOMS_KEY, JSON.stringify([null, {}, { token: "invalid" }]));
  await restoreRoom();
  expect(savedRoomConnections()).toEqual([]);
});
