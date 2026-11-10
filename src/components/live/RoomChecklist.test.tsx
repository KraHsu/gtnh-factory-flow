// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyProject } from "@/examples";
import { useDesignStore } from "@/store/design-store";
import { useFactoryStore } from "@/store/factory-store";
import { useLiveSession } from "@/store/live-session";
import { useRoomConnection } from "@/lib/rooms/connection";
import { updateTask } from "@/lib/tasks/task-board";
import { RoomChecklist } from "./RoomChecklist";

function bindRoom(id = "a") {
  useDesignStore.setState({
    activeDesignId: id,
    designs: [
      {
        id,
        name: "Room " + id,
        createdAt: "",
        updatedAt: "",
        cloud: { ownerId: "owner", ownerName: "Owner", designId: id },
      },
    ],
  });
  useRoomConnection.setState({
    connection: {
      designId: id,
      token: "room-token",
      expiresAt: null,
      user: { id: "guest", username: "Guest" },
      room: {
        code: "12345678",
        name: "Room " + id,
        ownerId: "owner",
        ownerName: "Owner",
        designId: id,
        createdAt: "",
        updatedAt: "",
      },
    },
  });
  useLiveSession.setState({ designId: id, doc: "owner:" + id, status: "live", pending: 0 });
}
beforeEach(() => {
  localStorage.clear();
  useFactoryStore.setState({
    project: {
      ...createEmptyProject(),
      tasks: [{ id: "t1", title: "Build EBF", status: "todo", order: "a0" }],
    },
    isReadOnly: false,
    undoHistory: [],
    redoHistory: [],
  });
  bindRoom();
});
afterEach(() => {
  cleanup();
  useRoomConnection.setState({ connection: undefined });
  useLiveSession.setState({ designId: undefined, doc: undefined, status: "off" });
});

it("lets a guest add, edit, complete and reopen room tasks without changing the factory board", () => {
  const before = useFactoryStore.getState().project;
  render(<RoomChecklist />);
  fireEvent.change(screen.getByRole("textbox", { name: "New to-do" }), {
    target: { value: "Prepare circuits" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to-do" }));
  expect(useFactoryStore.getState().project.tasks).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Edit Prepare circuits" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit to-do" }), {
    target: { value: "Prepare advanced circuits" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete Prepare advanced circuits" }));
  expect(
    useFactoryStore
      .getState()
      .project.tasks?.find((task) => task.title === "Prepare advanced circuits"),
  ).toMatchObject({ status: "done", doneAt: expect.any(String) });
  fireEvent.click(screen.getByRole("checkbox", { name: "Reopen Prepare advanced circuits" }));
  expect(
    useFactoryStore
      .getState()
      .project.tasks?.find((task) => task.title === "Prepare advanced circuits")?.status,
  ).toBe("todo");
  for (const field of ["recipes", "nodes", "edges", "primaryView"] as const)
    expect(useFactoryStore.getState().project[field]).toBe(before[field]);
});

it("keeps an edit draft when another member changes or completes that task", () => {
  render(<RoomChecklist />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Build EBF" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit to-do" }), {
    target: { value: "My draft" },
  });
  act(() => {
    const project = updateTask(useFactoryStore.getState().project, "t1", {
      title: "Other member's title",
    });
    useFactoryStore.setState({
      project: { ...project, tasks: project.tasks!.map((task) => ({ ...task, status: "done" })) },
    });
  });
  expect((screen.getByRole("textbox", { name: "Edit to-do" }) as HTMLInputElement).value).toBe(
    "My draft",
  );
  expect(
    screen.getByText(
      "Another member changed this item. Save to use your text, or cancel to keep theirs.",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(useFactoryStore.getState().project.tasks?.[0]).toMatchObject({
    title: "My draft",
    status: "done",
  });
});

it("retains a deleted task's unsaved draft without recreating it", () => {
  render(<RoomChecklist />);
  fireEvent.click(screen.getByRole("button", { name: "Edit Build EBF" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit to-do" }), {
    target: { value: "Keep this draft" },
  });
  act(() =>
    useFactoryStore.setState({ project: { ...useFactoryStore.getState().project, tasks: [] } }),
  );
  expect(
    screen.getByText("This item was removed by another member. Your draft is kept below."),
  ).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Edit to-do" }) as HTMLInputElement).value).toBe(
    "Keep this draft",
  );
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(useFactoryStore.getState().project.tasks).toEqual([]);
});

it("requires confirmation to delete a shared task", () => {
  render(<RoomChecklist />);
  fireEvent.click(screen.getByRole("button", { name: "Delete Build EBF" }));
  expect(useFactoryStore.getState().project.tasks).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useFactoryStore.getState().project.tasks).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete Build EBF" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  expect(useFactoryStore.getState().project.tasks).toEqual([]);
});

it("keeps a bound offline checklist editable but prevents edits when the binding is missing or belongs to another room", () => {
  useLiveSession.setState({ status: "offline" });
  render(<RoomChecklist />);
  expect(
    screen.getByText("Offline. Checklist edits are kept here and will sync when you reconnect."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete Build EBF" }));
  expect(useFactoryStore.getState().project.tasks?.[0].status).toBe("done");
  act(() => useLiveSession.setState({ doc: "owner:other-room" }));
  expect(
    (screen.getByRole("checkbox", { name: "Reopen Build EBF" }) as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Reopen Build EBF" }));
  expect(useFactoryStore.getState().project.tasks?.[0].status).toBe("done");
  act(() => useRoomConnection.setState({ connection: undefined }));
  expect((screen.getByRole("button", { name: "Add to-do" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("clears drafts when the room dialog opens a different room", () => {
  const { rerender } = render(<RoomChecklist key="a" />);
  fireEvent.change(screen.getByRole("textbox", { name: "New to-do" }), {
    target: { value: "Only for room A" },
  });
  act(() => {
    bindRoom("b");
    useFactoryStore.setState({ project: createEmptyProject() });
  });
  rerender(<RoomChecklist key="b" />);
  expect((screen.getByRole("textbox", { name: "New to-do" }) as HTMLInputElement).value).toBe("");
  expect(screen.queryByText("Build EBF")).toBeNull();
});
