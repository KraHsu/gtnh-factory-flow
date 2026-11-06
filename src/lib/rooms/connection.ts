"use client";

import { create } from "zustand";
import type { RoomAdmission } from "./types";

export const ROOM_STORAGE_KEY = "gtnh-room-session.v1";

export function roomsConfigured(): boolean {
  return process.env.NEXT_PUBLIC_ROOMS === "1";
}

export type RoomConnection = Omit<RoomAdmission, "plan"> & { designId: string };
export const useRoomConnection = create<{
  connection?: RoomConnection;
  dialog: "join" | "create" | "mine" | "current" | undefined;
}>(() => ({ dialog: undefined }));

export function openRoomDialog(dialog: "join" | "create" | "mine" | "current" = "join"): void {
  useRoomConnection.setState({ dialog });
}

export function clearRoomConnection(showJoin = false): void {
  useRoomConnection.setState({ connection: undefined, dialog: showJoin ? "join" : undefined });
  try {
    sessionStorage.removeItem(ROOM_STORAGE_KEY);
  } catch {
    /* Optional storage. */
  }
}
