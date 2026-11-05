"use client";
import { useT } from "@/lib/i18n";

import { Camera } from "lucide-react";
import { useState } from "react";
import { ExportImageDialog } from "./ExportImageDialog";

/** Available on every plan bar, including posted and view-only setups. */
export function ScreenshotButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("Screenshot")}
        aria-label={t("Screenshot")}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line-strong bg-surface text-fg-subtle hover:bg-surface-raised hover:text-fg"
      >
        <Camera aria-hidden className="h-3.5 w-3.5" />
      </button>
      {open ? <ExportImageDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
