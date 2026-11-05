"use client";
import { useT } from "@/lib/i18n";

import { memo } from "react";
import { X } from "lucide-react";
import { useFactoryStore } from "@/store/factory-store";

/**
 * Said once when a plan that arrived in an older mode could not be carried
 * over whole (a pool plan's pools became wires, a ratio buffer became plain
 * wires). Sits in the notice stack in the stack's anatomy; the key clears it.
 * The plan itself is not touched until the player edits it.
 */
export const PlanConversionNotice = memo(function PlanConversionNotice() {
  const t = useT();
  const notice = useFactoryStore((state) => state.planNotice);
  const dismiss = useFactoryStore((state) => state.dismissPlanNotice);
  // Plan boards say it in the notices bar (clean/rail/NoticeBar); this dress is for any board that has none.
  const inBar = useFactoryStore((state) => state.project.planMode === true);
  if (!notice || inBar) {
    return null;
  }
  return (
    <div
      role="status"
      data-plan-conversion-notice
      className="nodrag pointer-events-auto flex max-w-[min(calc(94*var(--ui-vw)),760px)] flex-wrap items-center justify-center gap-x-3 gap-y-1 border-2 border-[#6f9cff] bg-[#1a2233] px-3 py-2 font-mono text-[13px] text-[#d3dff4] shadow-[inset_2px_2px_0_#3e567d,inset_-2px_-2px_0_#101622,4px_4px_0_rgba(0,0,0,0.35)]"
    >
      <span>{notice.text}</span>
      {notice.details.map((line) => (
        <span key={line} className="text-[#adc7ff]">
          {line}
        </span>
      ))}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("Dismiss")}
        className="shrink-0 border border-[#6f9cff] bg-[#273957] p-0.5 text-[#dce7ff] hover:bg-[#334b70]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
