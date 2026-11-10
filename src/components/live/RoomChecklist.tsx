"use client";

import { useState, type FormEvent } from "react";
import { useT } from "@/lib/i18n";
import { PLAN_TASK_LIMITS } from "@/lib/model/schemas";
import type { FactoryProject } from "@/lib/model/types";
import { docKey } from "@/lib/live/protocol";
import { useRoomConnection } from "@/lib/rooms/connection";
import { addTask, deleteTask, moveTaskTo, updateTask } from "@/lib/tasks/task-board";
import { byOrder } from "@/lib/tasks/order-key";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { useLiveSession } from "@/store/live-session";

/** Recheck the binding at the edit, including when a room changed before React repainted. */
function editRoomTasks(
  designId: string | undefined,
  edit: (project: FactoryProject) => FactoryProject,
): boolean {
  const design = useDesignStore.getState();
  const room = useRoomConnection.getState().connection;
  const live = useLiveSession.getState();
  const ref = design.designs.find((entry) => entry.id === designId)?.cloud;
  if (
    !designId ||
    design.activeDesignId !== designId ||
    room?.designId !== designId ||
    !ref ||
    ref.ownerId !== room.room.ownerId ||
    ref.designId !== room.room.designId ||
    live.designId !== designId ||
    live.doc !== docKey(ref.ownerId, ref.designId) ||
    useFactoryStore.getState().isReadOnly
  )
    return false;
  useFactoryStore.getState().editTasks(edit);
  return true;
}

export function RoomChecklist() {
  const t = useT();
  const designId = useDesignStore((state) => state.activeDesignId);
  const design = useDesignStore((state) =>
    state.designs.find((entry) => entry.id === state.activeDesignId),
  );
  const connection = useRoomConnection((state) => state.connection);
  const liveDesignId = useLiveSession((state) => state.designId);
  const liveDoc = useLiveSession((state) => state.doc);
  const status = useLiveSession((state) => state.status);
  const pending = useLiveSession((state) => state.pending);
  const tasks = useFactoryStore((state) => state.project.tasks);
  const readOnly = useFactoryStore((state) => state.isReadOnly);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string; base: string }>();
  const [deleting, setDeleting] = useState<string>();
  const ordered = byOrder(tasks ?? []);
  const unfinished = ordered.filter((task) => task.status !== "done");
  const completed = ordered.filter((task) => task.status === "done");
  const ref = design?.cloud;
  const editable =
    !readOnly &&
    Boolean(
      designId &&
      ref &&
      connection?.designId === designId &&
      ref.ownerId === connection.room.ownerId &&
      ref.designId === connection.room.designId &&
      liveDesignId === designId &&
      liveDoc === docKey(ref.ownerId, ref.designId),
    );
  const original = editing && tasks?.find((task) => task.id === editing.id);
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (
      editRoomTasks(
        designId,
        (project) => addTask(project, { title, author: connection?.user }).project,
      )
    )
      setTitle("");
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !original || !editing.title.trim()) return;
    if (
      editRoomTasks(designId, (project) =>
        updateTask(project, editing.id, { title: editing.title }),
      )
    )
      setEditing(undefined);
  };
  return (
    <section className="room-section room-checklist" aria-label={t("Room checklist")}>
      <div className="room-todo-heading">
        <h3>{design?.name}</h3>
        <span>
          {t("{done} of {total} completed", { done: completed.length, total: ordered.length })}
        </span>
      </div>
      <p className="room-muted" role="status">
        {!editable
          ? t("Reconnect to this room to edit its checklist.")
          : status !== "live"
            ? t("Offline. Checklist edits are kept here and will sync when you reconnect.")
            : pending > 0
              ? t("Syncing room edits…")
              : t("Everyone in this room can edit this checklist. Changes are saved to the room.")}
      </p>
      <form className="room-todo-add" onSubmit={add}>
        <label>
          {t("New to-do")}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("What needs to be done?")}
            maxLength={PLAN_TASK_LIMITS.titleLength}
            required
            disabled={!editable}
            autoComplete="off"
          />
        </label>
        <button className="room-primary" type="submit" disabled={!editable || !title.trim()}>
          {t("Add to-do")}
        </button>
      </form>
      {editing && (
        <form className="room-todo-editor" onSubmit={save}>
          {!original ? (
            <p role="status">
              {t("This item was removed by another member. Your draft is kept below.")}
            </p>
          ) : (
            original.title !== editing.base && (
              <p role="status">
                {t(
                  "Another member changed this item. Save to use your text, or cancel to keep theirs.",
                )}
              </p>
            )
          )}
          <label>
            {t("Edit to-do")}
            <input
              value={editing.title}
              onChange={(event) => setEditing({ ...editing, title: event.target.value })}
              maxLength={PLAN_TASK_LIMITS.titleLength}
              required
              disabled={!editable}
              autoFocus
            />
          </label>
          <div className="room-todo-actions">
            <button
              className="room-primary"
              type="submit"
              disabled={!editable || !original || !editing.title.trim()}
            >
              {t("Save")}
            </button>
            <button type="button" onClick={() => setEditing(undefined)}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      )}
      {!ordered.length && (
        <p className="room-muted">{t("No to-dos yet. Add the first item for this room.")}</p>
      )}
      {[unfinished, completed].map(
        (group, index) =>
          group.length > 0 && (
            <section
              key={index}
              aria-label={t(index === 0 ? "Unfinished to-dos" : "Completed to-dos")}
            >
              <h4>
                {t(index === 0 ? "To do" : "Done")} <span>({group.length})</span>
              </h4>
              <ul className="room-todo-list">
                {group.map((task) => (
                  <li
                    key={task.id}
                    data-todo-id={task.id}
                    data-completed={task.status === "done" ? "" : undefined}
                  >
                    <div className="room-todo-row">
                      <input
                        type="checkbox"
                        checked={task.status === "done"}
                        disabled={!editable}
                        aria-label={t(
                          task.status === "done" ? "Reopen {title}" : "Complete {title}",
                          { title: task.title },
                        )}
                        onChange={(event) =>
                          editRoomTasks(designId, (project) =>
                            moveTaskTo(project, task.id, event.target.checked ? "done" : "todo"),
                          )
                        }
                      />
                      <div className="room-todo-text">
                        <span>{task.title}</span>
                        {task.text && <p className="room-muted">{task.text}</p>}
                      </div>
                      <div className="room-todo-actions">
                        <button
                          type="button"
                          disabled={!editable}
                          aria-label={t("Edit {title}", { title: task.title })}
                          onClick={() => {
                            setEditing({ id: task.id, title: task.title, base: task.title });
                            setDeleting(undefined);
                          }}
                        >
                          {t("Edit")}
                        </button>
                        <button
                          type="button"
                          className="room-danger"
                          disabled={!editable}
                          aria-label={t("Delete {title}", { title: task.title })}
                          onClick={() => setDeleting(task.id)}
                        >
                          {t("Delete")}
                        </button>
                      </div>
                    </div>
                    {deleting === task.id && (
                      <div
                        className="room-todo-delete"
                        role="group"
                        aria-label={t("Delete this to-do?")}
                      >
                        <span>{t("Delete this to-do?")}</span>
                        <button
                          type="button"
                          className="room-danger"
                          disabled={!editable}
                          onClick={() => {
                            if (editRoomTasks(designId, (project) => deleteTask(project, task.id)))
                              setDeleting(undefined);
                          }}
                        >
                          {t("Confirm delete")}
                        </button>
                        <button type="button" onClick={() => setDeleting(undefined)}>
                          {t("Cancel")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </section>
  );
}
