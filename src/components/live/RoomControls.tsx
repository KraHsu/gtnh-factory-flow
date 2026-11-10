"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";
import {
  roomsConfigured,
  openRoomDialog,
  useRoomConnection,
  REMEMBERED_ROOMS_KEY,
  refreshSavedRooms,
} from "@/lib/rooms/connection";
import {
  enterRoom,
  leaveRoom,
  restoreRoom,
  roomRequest,
  openRememberedRoom,
} from "@/lib/rooms/client";
import type { RoomAdmission, RoomIdentity, RoomInfo } from "@/lib/rooms/types";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { withoutRuntimeTables } from "@/lib/import-export/plan-code";
import { useLiveSession } from "@/store/live-session";
import { BarKey } from "../chrome/bar-parts";
import { ChecklistIcon } from "../chrome/pixel-icons";
import { RoomChecklist } from "./RoomChecklist";
import "./rooms.css";

export function RoomControls({ pictures }: { pictures: boolean }) {
  const t = useT();
  const dialog = useRoomConnection((state) => state.dialog);
  const connection = useRoomConnection((state) => state.connection);
  const hydrated = useDesignStore((state) => state.isHydrated);
  const activeId = useDesignStore((state) => state.activeDesignId);
  const roomPlan = useDesignStore((state) =>
    Boolean(state.designs.find((design) => design.id === state.activeDesignId)?.cloud),
  );
  useEffect(() => {
    if (!roomsConfigured() || !hydrated) return;
    const parameter = new URL(location.href).searchParams.get("rooms");
    if (parameter === "create") {
      openRoomDialog("create");
      const url = new URL(location.href);
      url.searchParams.delete("rooms");
      history.replaceState(null, "", url);
    }
    void restoreRoom();
  }, [hydrated, activeId]);
  useEffect(() => {
    if (!roomsConfigured()) return;
    const changed = (event: StorageEvent) => {
      if (event.key === REMEMBERED_ROOMS_KEY || event.key === null) {
        refreshSavedRooms();
        void restoreRoom();
      }
    };
    const online = () => {
      void restoreRoom();
    };
    window.addEventListener("storage", changed);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("online", online);
    };
  }, []);
  if (!roomsConfigured()) return null;
  return (
    <>
      <BarKey
        id="rooms"
        label={
          pictures
            ? undefined
            : t(roomPlan && connection?.designId !== activeId ? "Reconnect room" : "Rooms")
        }
        icon={pictures}
        ariaLabel={t("Collaboration rooms")}
        tip={t("Create a room or join with a room number, password and nickname")}
        onClick={() =>
          openRoomDialog(
            roomPlan && connection?.designId !== activeId
              ? "join"
              : connection
                ? "current"
                : "join",
          )
        }
      >
        {pictures ? <span aria-hidden>♟</span> : undefined}
      </BarKey>
      {roomPlan && (
        <BarKey
          id="room-todos"
          label={pictures ? undefined : t("To-do list")}
          icon={pictures}
          ariaLabel={t("Room checklist")}
          tip={t("Add, edit and complete to-dos with everyone in this room")}
          onClick={() => openRoomDialog("todos")}
        >
          {pictures ? <ChecklistIcon className="room-todo-icon" /> : undefined}
        </BarKey>
      )}
      {dialog ? <RoomDialog /> : null}
    </>
  );
}

function RoomDialog() {
  const t = useT();
  const dialog = useRoomConnection((state) => state.dialog)!;
  const connection = useRoomConnection((state) => state.connection);
  const saved = useRoomConnection((state) => state.saved);
  const activeId = useDesignStore((state) => state.activeDesignId);
  const activeRoom = useDesignStore(
    (state) => state.designs.find((design) => design.id === state.activeDesignId)?.cloud,
  );
  const hydrated = useDesignStore((state) => state.isHydrated);
  const status = useLiveSession((state) => state.status);
  const pending = useLiveSession((state) => state.pending);
  const people = useLiveSession((state) => state.present);
  const [identity, setIdentity] = useState<RoomIdentity | null | undefined>();
  const [mine, setMine] = useState<RoomInfo[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [remember, setRemember] = useState(true);
  const [name, setName] = useState(() => useFactoryStore.getState().project.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = () => useRoomConnection.setState({ dialog: undefined });
  useDialogA11y(dialogRef, { onClose: close });
  const change = (tab: typeof dialog) => {
    setError("");
    setPassword("");
    setConfirmClose(undefined);
    useRoomConnection.setState({ dialog: tab });
  };

  useEffect(() => {
    let active = true;
    void roomRequest<{ user: RoomIdentity | null }>("/identity")
      .then((result) => {
        if (active) setIdentity(result.user);
      })
      .catch(() => {
        if (active) setIdentity(null);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (dialog === "mine" && identity)
      void roomRequest<{ rooms: RoomInfo[] }>("")
        .then((result) => {
          if (active) setMine(result.rooms);
        })
        .catch((error) => {
          if (active)
            setError(
              error instanceof Error
                ? error.message
                : "The room service is unavailable. Try again shortly.",
            );
        });
    return () => {
      active = false;
    };
  }, [dialog, identity]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The room service is unavailable. Try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const admission =
        dialog === "create"
          ? await roomRequest<RoomAdmission>("", {
              name,
              password,
              nickname,
              remember,
              plan: withoutRuntimeTables(useFactoryStore.getState().project),
            })
          : await roomRequest<RoomAdmission>("/join", { code, password, nickname, remember });
      await enterRoom(admission);
      setPassword("");
    });
  };
  const loginURL = `https://iam.krahsu.top/auth/?rd=${encodeURIComponent(`${location.origin}/?rooms=create`)}`;
  return createPortal(
    <div
      className="room-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-heading"
        className="room-dialog"
      >
        <header>
          <h2 id="room-heading">{t("Collaboration rooms")}</h2>
          <button type="button" onClick={close} aria-label={t("Close")}>
            ×
          </button>
        </header>
        <nav aria-label={t("Room actions")}>
          {connection && (
            <button
              type="button"
              aria-pressed={dialog === "current"}
              onClick={() => change("current")}
            >
              {t("Current room")}
            </button>
          )}
          {activeRoom && (
            <button type="button" aria-pressed={dialog === "todos"} onClick={() => change("todos")}>
              {t("To-do list")}
            </button>
          )}
          <button type="button" aria-pressed={dialog === "join"} onClick={() => change("join")}>
            {t("Join room")}
          </button>
          <button type="button" aria-pressed={dialog === "create"} onClick={() => change("create")}>
            {t("Create room")}
          </button>
          <button type="button" aria-pressed={dialog === "mine"} onClick={() => change("mine")}>
            {t("My rooms")}
          </button>
        </nav>
        {error && (
          <p className="room-error" role="alert">
            {t(error)}
          </p>
        )}
        {dialog === "todos" && activeRoom && <RoomChecklist key={activeId} />}
        {(dialog === "create" || dialog === "mine") && !identity ? (
          <div className="room-section">
            <p>
              {t("Sign in with IAM to create or manage rooms. Guests can join without an account.")}
            </p>
            <a className="room-primary" href={loginURL}>
              {t("Sign in with IAM")}
            </a>
          </div>
        ) : null}
        {(dialog === "join" || (dialog === "create" && identity)) && (
          <form onSubmit={submit} className="room-section">
            {dialog === "join" && activeRoom && connection?.designId !== activeId && (
              <p className="room-muted" role="status">
                {t(
                  "This is a room plan. Reconnect to continue editing with others. Your cached edits are kept here.",
                )}
              </p>
            )}
            {dialog === "join" && saved.length > 0 && (
              <section aria-label={t("Remembered rooms")}>
                <h3>{t("Remembered rooms")}</h3>
                {saved.map((room) => (
                  <article className="room-list-item" key={room.room.code}>
                    <div>
                      <strong>{room.room.name}</strong>
                      <span>
                        {room.room.code} · {room.user.username}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => openRememberedRoom(room))}
                    >
                      {t("Open room")}
                    </button>
                  </article>
                ))}
              </section>
            )}
            {connection && (
              <p className="room-muted">
                {t("Joining another room disconnects this tab from the current room.")}
              </p>
            )}
            {dialog === "create" ? (
              <>
                <p className="room-muted">
                  {t(
                    "Create a shared copy of the current plan. Your local plan stays on this device.",
                  )}
                </p>
                <label>
                  {t("Room name")}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={80}
                    disabled={busy}
                  />
                </label>
              </>
            ) : (
              <label>
                {t("Room number")}
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  required
                  autoComplete="off"
                  disabled={busy}
                />
              </label>
            )}
            <label>
              {t("Room password")}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={dialog === "create" ? 8 : undefined}
                maxLength={128}
                autoComplete={dialog === "create" ? "new-password" : "off"}
                disabled={busy}
              />
            </label>
            {dialog === "create" && (
              <p className="room-muted">
                {t(
                  "Use at least 8 characters. Share the room number and password with your teammates.",
                )}
              </p>
            )}
            <label>
              {t("Your nickname")}
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
                maxLength={48}
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <p className="room-muted">
              {t(
                "Your nickname appears beside your cursor. The room stays available when its owner goes offline.",
              )}
            </p>
            <label className="room-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={busy}
              />
              {t("Remember this browser and join automatically")}
            </label>
            <button type="submit" className="room-primary" disabled={busy || !hydrated}>
              {t(
                busy ? "Connecting…" : dialog === "create" ? "Create and enter room" : "Enter room",
              )}
            </button>
          </form>
        )}
        {dialog === "current" && connection && (
          <div className="room-section">
            <h3>{connection.room.name}</h3>
            <div className="room-number">
              <span>{t("Room number")}</span>
              <strong>{connection.room.code}</strong>
              <button
                onClick={() => void run(() => navigator.clipboard.writeText(connection.room.code))}
              >
                {t("Copy room number")}
              </button>
            </div>
            <p>
              {t("Your nickname")}: {connection.user.username}
            </p>
            <p role="status">
              {activeId !== connection.designId
                ? t("This tab is viewing a local plan.")
                : t(
                    status === "live"
                      ? pending
                        ? "Syncing room edits…"
                        : "Connected. Room edits are saved on the server."
                      : "Reconnecting. Keep this tab open while edits are waiting.",
                  )}
            </p>
            {activeId === connection.designId && (
              <p>
                {t("Online members")}:{" "}
                {people.map((person) => person.username).join("、") || connection.user.username}
              </p>
            )}
            <p className="room-muted">
              {t(
                connection.expiresAt === null
                  ? "This browser remembers your room and nickname. Opening this plan reconnects automatically."
                  : "This room is remembered only until you close the browser.",
              )}
            </p>
            <p className="room-muted">
              {t(
                "Closing your browser does not close the room. Everyone can keep editing without the owner online.",
              )}
            </p>
            <p className="room-muted">
              {t(
                "If two people change the same field, the last change received by the server takes effect.",
              )}
            </p>
            {activeId !== connection.designId && (
              <button
                className="room-primary"
                onClick={() =>
                  void run(() => useDesignStore.getState().switchToDesign(connection.designId))
                }
              >
                {t("Return to room")}
              </button>
            )}
            <button disabled={busy || pending > 0} onClick={() => void run(leaveRoom)}>
              {t(pending ? "Waiting for edits to sync…" : "Forget and leave room")}
            </button>
          </div>
        )}
        {dialog === "mine" && identity && (
          <div className="room-section">
            <p className="room-muted">{t("Rooms remain on the server until you close them.")}</p>
            {!mine.length && <p>{t("You have no rooms yet.")}</p>}
            {mine.map((room) => (
              <article key={room.code} className="room-list-item">
                <div>
                  <strong>{room.name}</strong>
                  <span>{room.code}</span>
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    setCode(room.code);
                    change("join");
                  }}
                >
                  {t("Join room")}
                </button>
                <button
                  className="room-danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirmClose !== room.code) {
                      setConfirmClose(room.code);
                      return;
                    }
                    void run(async () => {
                      await roomRequest(`/${room.code}`, undefined, "DELETE");
                      setMine(mine.filter((item) => item.code !== room.code));
                      setConfirmClose(undefined);
                    });
                  }}
                >
                  {t(confirmClose === room.code ? "Confirm close room" : "Close room")}
                </button>
                {confirmClose === room.code && (
                  <p className="room-muted">
                    {t(
                      "Closing this room disconnects everyone and disables its room number. Export a plan file first if you need a copy.",
                    )}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
