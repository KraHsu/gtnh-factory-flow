"use client";
import { useT } from "@/lib/i18n";

import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";

import {
  Check,
  ChevronDown,
  ClipboardList,
  ClipboardPaste,
  Download,
  ImageDown,
  LoaderCircle,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { serializeFactoryProject } from "@/lib/import-export";
import { randomUUID } from "@/lib/random-id";
import { formatBoardDump } from "./flow/board-dump";
import { isEditableKeyboardTarget } from "./flow/keyboard";
import { useWelcomeTab } from "@/lib/welcome/welcome-tab";
import { useFactoryStore } from "@/store/factory-store";
import { copyToClipboard } from "@/lib/clipboard";
import { PastePlanDialog } from "./export/PastePlanDialog";
import { openPlanFile } from "@/lib/import-export/open-plan-file";
import { isLiveConfigured } from "@/lib/live/live-config";

/**
 * With live plans, Share invites people into a plan (the plan bar) and
 * posting a copy to the library is Publish; without, posting is Share.
 */
const PUBLISH_LABEL = isLiveConfigured() ? "Post a copy to Community" : "Share this setup";

interface BoardActionsProps {
  /**
   * `bar` is the top bar's icons. `list` is the compact menu: the same actions
   * as labelled rows, with the export dropdown flattened (no nested menus on
   * touch).
   */
  variant?: "bar" | "list";
  /** Lets the compact menu close itself once one of its rows has fired. */
  onAction?: () => void;
  /**
   * Opens the share dialog, which the header owns: on compact this component
   * lives in the menu sheet, which unmounts the moment a row fires.
   */
  onShare?: () => void;
  /** Opens the export-image dialog; owned by the header for the same reason. */
  onExportImage?: () => void;
}

/**
 * Plan actions (share, clean, import, paste, export) for the header bar or
 * the compact menu, plus the global undo/redo keyboard shortcuts.
 */
export function BoardActions({
  variant = "bar",
  onAction,
  onShare,
  onExportImage,
}: BoardActionsProps = {}) {
  const t = useT();
  const isReadOnly = useFactoryStore((state) => state.isReadOnly);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setExportMenuOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<
    { format: "json"; requestId: string } | undefined
  >();
  const project = useFactoryStore((state) => state.project);
  const isProjectImporting = useFactoryStore((state) => state.isProjectImporting);
  const cleanBoard = useFactoryStore((state) => state.cleanBoard);
  const undo = useFactoryStore((state) => state.undo);
  const redo = useFactoryStore((state) => state.redo);
  const lastResult = useFactoryStore((state) => state.lastResult);
  const selectedBoardIds = useFactoryStore((state) => state.selectedBoardIds);
  const [diagnosticsState, setDiagnosticsState] = useState<"idle" | "copied" | "failed">("idle");
  const [isPastingPlan, setPastingPlan] = useState(false);
  // Welcome COVERS the board, so the design underneath still has content and
  // Share would happily post it. But sharing a board you cannot see is a
  // trap, so the button waits until you are looking at the thing it posts.
  const isWelcomeCoveringBoard = useWelcomeTab().active;
  const canShare = !isWelcomeCoveringBoard && project.nodes.length > 0;
  const shareWord = isLiveConfigured() ? "Publish" : "Share";
  const shareTitle = isWelcomeCoveringBoard
    ? `${shareWord}: open a design tab first`
    : project.nodes.length === 0
      ? `${shareWord}: build something first`
      : PUBLISH_LABEL;

  const selectedCardCount = selectedBoardIds.length;
  const diagnosticsLabel =
    diagnosticsState === "copied"
      ? "Copied to clipboard"
      : diagnosticsState === "failed"
        ? "Could not reach the clipboard"
        : selectedCardCount > 0
          ? `Copy diagnostics (${selectedCardCount} selected)`
          : "Copy diagnostics (whole plan)";

  /**
   * Copies every selected card's machine, tier, config, overclock, rates and
   * verdict as JSON (the whole plan when nothing is selected). The menu stays
   * open because the row itself shows the confirmation.
   */
  const copyDiagnostics = async () => {
    const text = formatBoardDump({
      project,
      result: lastResult,
      selectedIds: selectedBoardIds,
    });
    setDiagnosticsState((await copyToClipboard(text)) ? "copied" : "failed");
    window.setTimeout(() => setDiagnosticsState("idle"), 2000);
  };

  const exportJson = async () => {
    const requestId = randomUUID();
    setExportMenuOpen(false);
    setPendingExport({ format: "json", requestId });
    await nextAnimationFrame();

    const json = serializeFactoryProject(project);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    window.setTimeout(() => {
      setPendingExport((current) => (current?.requestId === requestId ? undefined : current));
    }, 450);
  };

  /**
   * An imported file opens as a NEW design tab, never over the plan on the
   * board: the Library can cover the board without closing its design, so an
   * import there would silently replace it and its undo history. Same path as
   * Paste and shared links; the post link is dropped.
   */
  const importProjectJson = async (file: File) => {
    try {
      await openPlanFile(file);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Plan import failed.");
    } finally {
      if (projectInputRef.current) {
        projectInputRef.current.value = "";
      }
    }
  };

  useDropdownDismiss(isExportMenuOpen, {
    refs: [exportMenuRef],
    onClose: () => setExportMenuOpen(false),
    fade: true,
  });

  useEffect(() => {
    const handleProjectHistoryShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      // Typing owns its own history: Ctrl+Z in a rename field or note must
      // undo the typing, not the board.
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (key === "y" && !event.shiftKey) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleProjectHistoryShortcut);
    return () => window.removeEventListener("keydown", handleProjectHistoryShortcut);
  }, [redo, undo]);

  const requestCleanBoard = () => {
    if (project.nodes.length === 0 && project.edges.length === 0) {
      return;
    }

    if (!window.confirm("Clean the board and remove all nodes and links?")) {
      return;
    }

    cleanBoard();
  };

  const planFileInput = (
    <input
      ref={projectInputRef}
      type="file"
      accept="application/json,image/svg+xml,image/png,.json,.svg,.png"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) {
          void importProjectJson(file);
        }
      }}
    />
  );

  if (isReadOnly) return null;

  if (variant === "list") {
    return (
      <div data-help-anchor="plan-actions" className="flex flex-col">
        {onShare ? (
          <MenuAction
            icon={Share2}
            label={PUBLISH_LABEL}
            disabled={!canShare}
            onClick={() => {
              onShare();
              onAction?.();
            }}
          />
        ) : null}
        <MenuAction
          icon={Trash2}
          label={t("Clean the board")}
          onClick={() => {
            requestCleanBoard();
            onAction?.();
          }}
        />
        <MenuAction
          icon={Upload}
          label={t("Import a plan")}
          disabled={isProjectImporting}
          onClick={() => {
            projectInputRef.current?.click();
            onAction?.();
          }}
        />
        <MenuAction
          icon={ClipboardPaste}
          label={t("Paste a copied plan")}
          onClick={() => setPastingPlan(true)}
        />
        <MenuAction
          icon={diagnosticsState === "copied" ? Check : ClipboardList}
          label={diagnosticsLabel}
          onClick={() => {
            void copyDiagnostics();
          }}
        />
        <MenuAction
          icon={Download}
          label={t("Export as JSON")}
          disabled={Boolean(pendingExport)}
          onClick={() => {
            void exportJson();
            onAction?.();
          }}
        />
        {onExportImage ? (
          <MenuAction
            icon={ImageDown}
            label={t("Export an image")}
            onClick={() => {
              onExportImage();
              onAction?.();
            }}
          />
        ) : null}
        {planFileInput}
        {isPastingPlan ? (
          <PastePlanDialog
            onClose={() => {
              setPastingPlan(false);
              onAction?.();
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div data-help-anchor="plan-actions" className="flex shrink-0 items-center gap-1">
      <div className="flex items-center gap-1">
        {/* No undo/redo or clean-board buttons here; undo/redo live on the
            board's build toolbar. Share, import, paste and the exports sit
            behind the one plan menu. */}
        <div ref={exportMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setExportMenuOpen((isOpen) => !isOpen)}
            title={t("Plan: share, import, export")}
            aria-label={t("Plan menu: share, import, export")}
            aria-expanded={isExportMenuOpen}
            aria-busy={pendingExport ? true : undefined}
            disabled={Boolean(pendingExport)}
            className="inline-flex h-5 items-center justify-center gap-0.5 rounded border border-line-strong bg-surface px-1.5 text-fg-subtle hover:bg-surface-raised disabled:cursor-wait disabled:bg-surface-sunken disabled:text-fg-muted"
          >
            {pendingExport ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <ChevronDown className="h-3 w-3" />
          </button>
          {isExportMenuOpen ? (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-44 rounded border border-line-strong bg-surface py-1 text-sm shadow-lg">
              {onShare ? (
                <ExportMenuItem
                  icon={Share2}
                  label={PUBLISH_LABEL}
                  title={shareTitle}
                  disabled={!canShare}
                  onClick={() => {
                    setExportMenuOpen(false);
                    onShare();
                  }}
                />
              ) : null}
              <ExportMenuItem
                icon={Upload}
                label={t("Import a plan...")}
                disabled={isProjectImporting}
                onClick={() => {
                  setExportMenuOpen(false);
                  projectInputRef.current?.click();
                }}
              />
              <ExportMenuItem
                icon={ClipboardPaste}
                label={t("Paste a copied plan...")}
                onClick={() => {
                  setExportMenuOpen(false);
                  setPastingPlan(true);
                }}
              />
              <div className="my-1 border-t border-line-strong" />
              <ExportMenuItem
                icon={diagnosticsState === "copied" ? Check : ClipboardList}
                label={diagnosticsLabel}
                onClick={() => {
                  void copyDiagnostics();
                }}
              />
              <div className="my-1 border-t border-line-strong" />
              <ExportMenuItem
                icon={Download}
                label={t("Export plan JSON")}
                onClick={() => {
                  void exportJson();
                }}
              />
              {onExportImage ? (
                <ExportMenuItem
                  icon={ImageDown}
                  label={t("Export an image...")}
                  onClick={() => {
                    setExportMenuOpen(false);
                    onExportImage();
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {planFileInput}
      {isPastingPlan ? <PastePlanDialog onClose={() => setPastingPlan(false)} /> : null}
    </div>
  );
}

/**
 * One row of the compact menu: a 40px tap target with the top bar's icon and
 * its label written out.
 */
function MenuAction({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-full items-center gap-2.5 rounded px-2 text-left text-sm text-fg-subtle hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-fg-muted"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function ExportMenuItem({
  icon: Icon,
  label,
  title,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-fg-subtle hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-fg-muted"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
