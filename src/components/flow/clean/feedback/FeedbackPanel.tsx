"use client";
import { useT } from "@/lib/i18n";

import { Bug, Lightbulb, CircleHelp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OPEN_FEEDBACK_EVENT } from "@/components/chrome/chrome-events";
import { activateOnKey } from "@/lib/hooks/button-keys";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";
import { withoutRuntimeTables } from "@/lib/import-export/plan-code";
import { useFactoryStore } from "@/store/factory-store";
import { latestMinimapScene } from "../minimap/scene-store";
import { planPictureBase64 } from "../minimap/picture";
import {
  buildReport,
  DISCORD_URL,
  faceRects,
  KINDS,
  MOODS,
  promptFor,
  sendsLine,
  titleOf,
  type FeedbackKind,
  type FeedbackMood,
} from "./feedback-model";
import { closeFeedback, openFeedback, useFeedbackOpen } from "./feedback-store";
import "./feedback.css";
import { playSfx, sfxToggle } from "@/lib/sound/sfx";

/**
 * The top bar's Feedback, small and friendly (the mod's FeedbackPanel): three big faces (how it's going, if you
 * like), what it is (a bug, an idea, or a call for help, which points to the Discord first), one box to write in,
 * a line saying what goes with it, and Send, which opens a public issue on the planner's repo through the site's
 * own /api/feedback (no account) and shows its link. What goes with it from a page: the open plan and a Simple
 * picture of it. No game log (a page has none).
 */

function Face({
  mood,
  picked,
  hot,
  size,
}: {
  mood: number;
  picked: boolean;
  hot: boolean;
  size: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 16 16"
      shapeRendering="crispEdges"
      aria-hidden
      className="fb-face-svg"
    >
      {faceRects(mood, picked, hot).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </svg>
  );
}

const KIND_ICONS = { bug: Bug, idea: Lightbulb, help: CircleHelp } as const;

type Sent = { number: number; url: string };

export function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [mood, setMood] = useState<FeedbackMood | undefined>(undefined);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState<Sent | undefined>(undefined);
  const [hotFace, setHotFace] = useState(-1);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogA11y(dialogRef, { onClose, initialFocus: "textarea" });
  const hasPlan = useFactoryStore((s) => s.project.nodes.length > 0);
  const planName = useFactoryStore((s) => s.project.name);
  const scene = latestMinimapScene();
  const pictureAvailable = hasPlan && Boolean(scene && scene.tiles.length > 0);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const send = async () => {
    if (!titleOf(text)) {
      setError("Write a line about it first");
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      const project = useFactoryStore.getState().project;
      let picture: string | undefined;
      if (hasPlan && scene) {
        const font =
          getComputedStyle(document.body).getPropertyValue("--font-minecraft") || "monospace";
        picture = planPictureBase64(scene, font);
      }
      const report = buildReport({
        kind,
        mood,
        text,
        plan: hasPlan
          ? { name: project.name || "Plan", plan: withoutRuntimeTables(project) }
          : undefined,
        picture,
      });
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      const body = (await response.json().catch(() => ({}))) as {
        number?: number;
        url?: string;
        error?: string;
      };
      if (!response.ok || typeof body.number !== "number" || typeof body.url !== "string") {
        throw new Error(body.error ?? `The site answered ${response.status}`);
      }
      setSent({ number: body.number, url: body.url });
      playSfx("note.stick");
    } catch (e) {
      setError(`Couldn't send it: ${e instanceof Error ? e.message : "no answer"}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fb-backdrop" data-feedback-backdrop="">
      <div
        ref={dialogRef}
        className="fb"
        role="dialog"
        aria-modal="true"
        aria-label={t("Send feedback")}
      >
        <div className="fb-title">
          <span>{t("Send feedback")}</span>
          <div
            role="button"
            tabIndex={0}
            aria-label={t("Close")}
            className="fb-x"
            data-sfx-own=""
            onClick={() => {
              playSfx("ui.close");
              onClose();
            }}
            onKeyDown={activateOnKey}
          />
        </div>
        {sent ? (
          <div className="fb-sent">
            <Face mood={0} picked hot={false} size={50} />
            <div className="fb-sent-line">{t("Thanks! It's sent.")}</div>
            <div className="fb-sent-sub">
              Issue #{sent.number} {t("on GitHub")}
            </div>
            <div className="fb-keys">
              <div
                role="button"
                tabIndex={0}
                onKeyDown={activateOnKey}
                className="fb-key fb-key-primary"
                onClick={() => window.open(sent.url, "_blank", "noopener")}
              >
                {t("Open it")}
              </div>
              <div
                role="button"
                tabIndex={0}
                onKeyDown={activateOnKey}
                className="fb-key"
                onClick={() => void navigator.clipboard?.writeText(sent.url).catch(() => undefined)}
              >
                {t("Copy link")}
              </div>
              <div
                role="button"
                tabIndex={0}
                onKeyDown={activateOnKey}
                className="fb-key"
                onClick={onClose}
              >
                {t("Done")}
              </div>
            </div>
          </div>
        ) : (
          <div className="fb-body">
            <div className="fb-faces">
              {MOODS.map((m, i) => (
                <div
                  key={m}
                  role="button"
                  aria-label={m === "happy" ? "Happy" : m === "okay" ? "Okay" : "Unhappy"}
                  aria-pressed={mood === m}
                  tabIndex={0}
                  onKeyDown={activateOnKey}
                  className="fb-face"
                  onMouseEnter={() => setHotFace(i)}
                  onMouseLeave={() => setHotFace(-1)}
                  data-sfx-own=""
                  onClick={() => {
                    if (sending) return;
                    setMood(mood === m ? undefined : m);
                    sfxToggle(mood !== m);
                  }}
                >
                  <Face mood={i} picked={mood === m} hot={hotFace === i && !sending} size={36} />
                </div>
              ))}
            </div>
            <div className="fb-kinds" role="radiogroup" aria-label="What it is">
              {KINDS.map((k) => {
                const Icon = KIND_ICONS[k.id];
                return (
                  <div
                    key={k.id}
                    role="radio"
                    aria-checked={kind === k.id}
                    tabIndex={0}
                    onKeyDown={activateOnKey}
                    className="fb-kind"
                    data-on={kind === k.id ? "" : undefined}
                    style={{ ["--kc" as string]: k.colour }}
                    data-sfx-own=""
                    onClick={() => {
                      if (sending || kind === k.id) return;
                      setKind(k.id);
                      playSfx("ui.tick", 1, 1 + 0.1 * KINDS.indexOf(k));
                    }}
                  >
                    <Icon size={12} strokeWidth={2.4} />
                    <span>{k.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="fb-prompt">
              <span>{promptFor(kind)}</span>
              {kind === "help" ? (
                <a
                  className="fb-discord"
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("Open Discord")}
                </a>
              ) : null}
            </div>
            <textarea
              ref={areaRef}
              className="fb-area"
              value={text}
              disabled={sending}
              maxLength={8000}
              onChange={(e) => setText(e.target.value)}
              aria-label="Your feedback"
            />
            <div className="fb-sends">
              {sendsLine(hasPlan ? planName || "Plan" : undefined, pictureAvailable)}
            </div>
            <div className="fb-foot">
              <span className="fb-where" data-error={error ? "" : undefined}>
                {error ?? "It becomes a public issue on GitHub."}
              </span>
              <div
                role="button"
                aria-disabled={sending}
                tabIndex={0}
                onKeyDown={activateOnKey}
                className="fb-send"
                data-sending={sending ? "" : undefined}
                onClick={() => !sending && void send()}
              >
                {sending ? "Sending..." : "Send"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Mount once near the app root: shows the box while openFeedback() has been called. */
export function FeedbackHost() {
  const open = useFeedbackOpen();
  useEffect(() => {
    // The top bar's red key knocks on this door; taking the knock keeps its GitHub fallback unused.
    const onKnock = (event: Event) => {
      event.preventDefault();
      openFeedback();
    };
    window.addEventListener(OPEN_FEEDBACK_EVENT, onKnock);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, onKnock);
  }, []);
  useEffect(() => {
    // A handle for checking the box by hand in development.
    if (process.env.NODE_ENV !== "production")
      (window as unknown as { __openFeedback?: () => void }).__openFeedback = openFeedback;
  }, []);
  return open ? <FeedbackPanel onClose={closeFeedback} /> : null;
}
