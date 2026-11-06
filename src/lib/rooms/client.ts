"use client";

import { parseFactoryProjectJson } from "@/lib/import-export";
import { useDesignStore } from "@/store/design-store";
import { clearRoomConnection, ROOM_STORAGE_KEY, useRoomConnection } from "./connection";
import type { RoomAdmission } from "./types";

export class RoomRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function roomRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(`/api/rooms${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new RoomRequestError(
      response.status,
      result.error ?? "The room service is unavailable. Try again shortly.",
    );
  return result as T;
}

export async function enterRoom(admission: RoomAdmission): Promise<void> {
  const ref = {
    ownerId: admission.room.ownerId,
    ownerName: admission.room.ownerName,
    designId: admission.room.designId,
  };
  const project = parseFactoryProjectJson(JSON.stringify(admission.plan));
  // The room gets its own design. The canvas being edited before joining remains a local plan.
  await useDesignStore.getState().openSharedDesign(ref, admission.room.name, project);
  const designId = useDesignStore.getState().activeDesignId!;
  const { plan, ...credentials } = admission;
  void plan;
  useRoomConnection.setState({ connection: { ...credentials, designId }, dialog: undefined });
  try {
    sessionStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({ token: admission.token }));
  } catch {
    /* The open tab can still collaborate when storage is unavailable. */
  }
}

let restoring: Promise<void> | undefined;
export function restoreRoom(): Promise<void> {
  return (restoring ??= (async () => {
    try {
      const raw = sessionStorage.getItem(ROOM_STORAGE_KEY);
      if (!raw || useRoomConnection.getState().connection) return;
      const { token } = JSON.parse(raw) as { token?: unknown };
      if (typeof token !== "string") return;
      const admission = await roomRequest<RoomAdmission>("/resume", { token });
      await enterRoom(admission);
    } catch (error) {
      if (error instanceof RoomRequestError && error.status === 401) {
        clearRoomConnection(true);
      }
    }
  })().finally(() => {
    restoring = undefined;
  }));
}

export async function leaveRoom(): Promise<void> {
  const connection = useRoomConnection.getState().connection;
  if (!connection) return;
  // A request failure leaves the local connection intact, including any edits waiting to send.
  await roomRequest("/leave", { token: connection.token });
  clearRoomConnection();
}
