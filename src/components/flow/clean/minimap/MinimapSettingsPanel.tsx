"use client";
import { useT } from "@/lib/i18n";

import { useEffect, useRef } from "react";
import {
  MINIMAP_CORNER_LABELS,
  MINIMAP_SIZE_LABELS,
  setMinimap,
  useMinimapSettings,
  type MinimapCorner,
  type MinimapShape,
  type MinimapSize,
} from "./minimap-settings";
import "./minimap.css";

const SIZES: MinimapSize[] = ["small", "medium", "large", "huge"];
const SHAPES: MinimapShape[] = ["circle", "square"];
const CORNERS: MinimapCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/**
 * The minimap's settings, row by row, as the mod's Minimap section: Show, Size, Shape, Position, Centre on the card
 * you select. Used by the map's own gear and by the settings dialog.
 */
export function MinimapSettingsRows({ className = "" }: { className?: string }) {
  const t = useT();
  const s = useMinimapSettings();
  return (
    <div className={`mmap-rows ${className}`} role="group" aria-label={t("Minimap settings")}>
      <div className="mmap-row">
        <span className="mmap-row-name">
          {t("Show the minimap")} <kbd className="mmap-kbd">N</kbd>
        </span>
        <div
          role="switch"
          aria-checked={s.show}
          tabIndex={0}
          className="mmap-switch"
          data-on={s.show ? "" : undefined}
          onClick={() => setMinimap({ show: !s.show })}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setMinimap({ show: !s.show })}
        />
      </div>
      <div className="mmap-row">
        <span className="mmap-row-name">{t("Size")}</span>
        <div className="mmap-seg" role="radiogroup" aria-label={t("Size")}>
          {SIZES.map((size) => (
            <div
              key={size}
              role="radio"
              aria-checked={s.size === size}
              tabIndex={0}
              className="mmap-seg-item"
              data-on={s.size === size ? "" : undefined}
              onClick={() => setMinimap({ size })}
            >
              {t(MINIMAP_SIZE_LABELS[size])}
            </div>
          ))}
        </div>
      </div>
      <div className="mmap-row">
        <span className="mmap-row-name">{t("Shape")}</span>
        <div className="mmap-seg" role="radiogroup" aria-label={t("Shape")}>
          {SHAPES.map((shape) => (
            <div
              key={shape}
              role="radio"
              aria-checked={s.shape === shape}
              tabIndex={0}
              className="mmap-seg-item"
              data-on={s.shape === shape ? "" : undefined}
              onClick={() => setMinimap({ shape })}
            >
              {t(shape === "circle" ? t("Circle") : t("Square"))}
            </div>
          ))}
        </div>
      </div>
      <div className="mmap-row">
        <span className="mmap-row-name">{t("Position")}</span>
        <span className="mmap-row-aside">{t(MINIMAP_CORNER_LABELS[s.corner])}</span>
        <div className="mmap-corners" role="radiogroup" aria-label={t("Position")}>
          {CORNERS.map((corner) => (
            <div
              key={corner}
              role="radio"
              aria-checked={s.corner === corner}
              aria-label={MINIMAP_CORNER_LABELS[corner]}
              tabIndex={0}
              className="mmap-corner"
              data-on={s.corner === corner ? "" : undefined}
              onClick={() => setMinimap({ corner })}
            />
          ))}
        </div>
      </div>
      <div className="mmap-row">
        <span className="mmap-row-name">{t("Centre on the card you select")}</span>
        <div
          role="switch"
          aria-checked={s.follow}
          tabIndex={0}
          className="mmap-switch"
          data-on={s.follow ? "" : undefined}
          onClick={() => setMinimap({ follow: !s.follow })}
          onKeyDown={(e) =>
            (e.key === " " || e.key === "Enter") && setMinimap({ follow: !s.follow })
          }
        />
      </div>
    </div>
  );
}

/** The map's gear popover: the rows in a small panel beside it, shut by Escape or a press away from it. */
export function MinimapSettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".mmap-gear")) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="mmap-panel nodrag nopan nowheel"
      role="dialog"
      aria-label={t("Minimap settings")}
    >
      <div className="mmap-panel-head">
        <span>{t("Minimap")}</span>
        <div role="button" aria-label={t("Close")} className="mmap-panel-x" onClick={onClose} />
      </div>
      <MinimapSettingsRows />
    </div>
  );
}
