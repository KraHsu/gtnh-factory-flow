export interface RoomInfo {
  code: string;
  name: string;
  ownerId: string;
  ownerName: string;
  designId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomAdmission {
  room: RoomInfo;
  token: string;
  user: { id: string; username: string };
  /** Remembered browser access is revoked by leaving or closing the room. */
  expiresAt: number | null;
  plan: unknown;
}

export interface RoomIdentity {
  username: string;
  name: string;
}

export const ROOM_SESSION_MS = 24 * 60 * 60 * 1000;
export const ROOM_PROTOCOL = "gtnh-room-v1";
export const ROOM_CODE = /^\d{8}$/;
