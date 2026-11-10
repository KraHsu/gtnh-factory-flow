"use client";

import { create } from "zustand";
import type { RoomAdmission } from "./types";

export const ROOM_STORAGE_KEY = "gtnh-room-session.v1";
export const REMEMBERED_ROOMS_KEY = "gtnh-remembered-rooms.v1";
export const TAB_ROOMS_KEY = "gtnh-tab-rooms.v1";

export function roomsConfigured(): boolean {
  return process.env.NEXT_PUBLIC_ROOMS === "1";
}

export type RoomConnection = Omit<RoomAdmission, "plan"> & { designId: string };
export const useRoomConnection = create<{
  connection?: RoomConnection;
  saved: RoomConnection[];
  dialog: "join" | "create" | "mine" | "current" | "todos" | undefined;
}>(() => ({ dialog: undefined, saved: [] }));

function storage(persistent: boolean): Storage | undefined {
  try {
    return persistent ? localStorage : sessionStorage;
  } catch {
    return undefined;
  }
}

function read(persistent: boolean): RoomConnection[] {
  try {
    const value: unknown = JSON.parse(
      storage(persistent)?.getItem(persistent ? REMEMBERED_ROOMS_KEY : TAB_ROOMS_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is RoomConnection =>
        entry &&
        typeof entry === "object" &&
        /^[A-Za-z0-9_-]{43}$/.test(entry.token) &&
        typeof entry.designId === "string" &&
        typeof entry.user?.id === "string" &&
        typeof entry.user?.username === "string" &&
        /^\d{8}$/.test(entry.room?.code) &&
        ["name", "ownerId", "ownerName", "designId", "createdAt", "updatedAt"].every(
          (key) => typeof entry.room[key] === "string",
        ) &&
        (entry.expiresAt === null ||
          (typeof entry.expiresAt === "number" && Number.isFinite(entry.expiresAt))),
    );
  } catch {
    return [];
  }
}

function write(persistent: boolean, entries: RoomConnection[]): void {
  try {
    storage(persistent)?.setItem(
      persistent ? REMEMBERED_ROOMS_KEY : TAB_ROOMS_KEY,
      JSON.stringify(entries),
    );
  } catch {
    /* A tab can still collaborate when browser storage is unavailable. */
  }
}

export function savedRoomConnections(): RoomConnection[] {
  const entries = new Map(read(true).map((entry) => [entry.room.code, entry]));
  for (const entry of read(false)) entries.set(entry.room.code, entry);
  return [...entries.values()];
}

export function refreshSavedRooms(): void {
  useRoomConnection.setState({ saved: savedRoomConnections() });
}

export function rememberRoomConnection(connection: RoomConnection): void {
  const persistent = connection.expiresAt === null;
  write(persistent, [
    ...read(persistent).filter((entry) => entry.room.code !== connection.room.code),
    connection,
  ]);
  write(
    !persistent,
    read(!persistent).filter((entry) => entry.room.code !== connection.room.code),
  );
  refreshSavedRooms();
}

export function forgetRoomConnection(connection: RoomConnection): void {
  // A late refusal for an old admission must not erase a newer admission in another tab.
  for (const persistent of [true, false])
    write(
      persistent,
      read(persistent).filter((entry) => entry.token !== connection.token),
    );
  refreshSavedRooms();
}

export function openRoomDialog(
  dialog: "join" | "create" | "mine" | "current" | "todos" = "join",
): void {
  useRoomConnection.setState({ dialog });
}

export function clearRoomConnection(showJoin = false): void {
  const connection = useRoomConnection.getState().connection;
  if (connection) forgetRoomConnection(connection);
  useRoomConnection.setState({ connection: undefined, dialog: showJoin ? "join" : undefined });
  try {
    sessionStorage.removeItem(ROOM_STORAGE_KEY);
  } catch {
    /* Optional storage. */
  }
}
