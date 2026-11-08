"use client";

import { parseFactoryProjectJson } from "@/lib/import-export";
import { useDesignStore, sharedDesignLocalId } from "@/store/design-store";
import {
  clearRoomConnection,
  ROOM_STORAGE_KEY,
  useRoomConnection,
  rememberRoomConnection,
  savedRoomConnections,
  refreshSavedRooms,
  forgetRoomConnection,
  type RoomConnection,
} from "./connection";
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
  const connection = { ...credentials, designId };
  rememberRoomConnection(connection);
  useRoomConnection.setState({ connection, dialog: undefined });
  try {
    sessionStorage.removeItem(ROOM_STORAGE_KEY);
  } catch {
    /* The open tab can still collaborate when storage is unavailable. */
  }
}

const restoring = new Map<string, Promise<void>>();
export function restoreRoom(): Promise<void> {
  refreshSavedRooms();
  const { activeDesignId, designs } = useDesignStore.getState();
  const design = designs.find((entry) => entry.id === activeDesignId);
  const saved = savedRoomConnections().find(
    (entry) =>
      design?.cloud &&
      entry.room.ownerId === design.cloud.ownerId &&
      entry.room.designId === design.cloud.designId,
  );
  if (!saved) return restoreLegacyRoom();
  const connection = { ...saved, designId: activeDesignId! };
  if (
    useRoomConnection.getState().connection?.token === saved.token &&
    useRoomConnection.getState().connection?.designId === activeDesignId
  )
    return Promise.resolve();
  // Bind the cached room before any network wait: offline edits belong to its pending queue.
  useRoomConnection.setState({ connection });
  return refreshRoom(connection);
}

function refreshRoom(connection: RoomConnection): Promise<void> {
  const pending = restoring.get(connection.token);
  if (pending) return pending;
  const request = (async () => {
    try {
      const { plan, ...credentials } = await roomRequest<RoomAdmission>("/resume", {
        token: connection.token,
      });
      void plan;
      if (!savedRoomConnections().some((entry) => entry.token === connection.token)) return;
      const renewed = { ...credentials, designId: connection.designId };
      rememberRoomConnection(renewed);
      if (useRoomConnection.getState().connection?.token === connection.token)
        useRoomConnection.setState({ connection: renewed });
    } catch (error) {
      if (error instanceof RoomRequestError && error.status === 401) {
        forgetRoomConnection(connection);
        if (useRoomConnection.getState().connection?.token === connection.token)
          clearRoomConnection(true);
      }
      // A network failure keeps both the credential and the live engine's offline queue.
    }
  })().finally(() => restoring.delete(connection.token));
  restoring.set(connection.token, request);
  return request;
}

let legacyRestore: Promise<void> | undefined;
function restoreLegacyRoom(): Promise<void> {
  return (legacyRestore ??= (async () => {
    try {
      const raw = sessionStorage.getItem(ROOM_STORAGE_KEY);
      if (!raw) return;
      const { token } = JSON.parse(raw) as { token?: unknown };
      if (typeof token !== "string") return;
      const { plan, ...admission } = await roomRequest<RoomAdmission>("/resume", {
        token,
        remember: true,
      });
      void plan;
      const connection = { ...admission, designId: sharedDesignLocalId(admission.room) };
      rememberRoomConnection(connection);
      sessionStorage.removeItem(ROOM_STORAGE_KEY);
      const { activeDesignId, designs } = useDesignStore.getState();
      const design = designs.find((entry) => entry.id === activeDesignId);
      if (
        design?.cloud?.ownerId === admission.room.ownerId &&
        design.cloud.designId === admission.room.designId
      )
        useRoomConnection.setState({ connection: { ...connection, designId: activeDesignId! } });
    } catch (error) {
      if (error instanceof RoomRequestError && error.status === 401)
        sessionStorage.removeItem(ROOM_STORAGE_KEY);
    }
  })().finally(() => {
    legacyRestore = undefined;
  }));
}

export async function openRememberedRoom(connection: RoomConnection): Promise<void> {
  const opened = await useDesignStore
    .getState()
    .openSharedDesign(connection.room, connection.room.name);
  if (!opened) {
    try {
      await enterRoom(await roomRequest<RoomAdmission>("/resume", { token: connection.token }));
    } catch (error) {
      if (error instanceof RoomRequestError && error.status === 401)
        forgetRoomConnection(connection);
      throw error;
    }
    return;
  }
  await restoreRoom();
  if (useRoomConnection.getState().connection?.token === connection.token)
    useRoomConnection.setState({ dialog: undefined });
}

export async function leaveRoom(): Promise<void> {
  const connection = useRoomConnection.getState().connection;
  if (!connection) return;
  // A request failure leaves the local connection intact, including any edits waiting to send.
  await roomRequest("/leave", { token: connection.token });
  forgetRoomConnection(connection);
  if (useRoomConnection.getState().connection?.token === connection.token) clearRoomConnection();
}
