"use client";
import { useDisplayT as useT } from "@/lib/i18n/game";

import { Bug } from "lucide-react";
import { openFeedback } from "./feedback-store";

/**
 * The top bar's red bug key (the mod's Feedback key). The chrome places it; it only opens the box
 * (FeedbackHost shows it).
 */
export function FeedbackKey({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("Send feedback")}
      title={t("Send feedback: a bug, an idea, or a question")}
      className={`fb-topkey ${className}`}
      onClick={openFeedback}
    >
      <Bug size={14} strokeWidth={2.4} />
    </button>
  );
}
