"use client";
import { useT } from "@/lib/i18n";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { FormulaLine, FormulaTerm } from "@/lib/machines/formula-lines";

/** One browser-wide fold for every machine card's worked formulas (the crop card keeps its own). */
const MACHINE_FORMULAS_OPEN_KEY = "gtnh-factory-flow.machine-formulas-open.v1";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(MACHINE_FORMULAS_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(MACHINE_FORMULAS_OPEN_KEY, open ? "1" : "0");
  } catch {
    // A private window: the fold just doesn't stick.
  }
}

/** Each setting's number wears a colour of its own, so a moved knob's number moves here in the same colour. */
const KNOB_COLORS: Record<string, string> = {
  tier: "#5aa7d9",
  amps: "#5aa7d9",
  tgsLogTool: "#c9a24a",
  tgsSaplingTool: "#6fbf50",
  tgsLeavesTool: "#3fb08a",
  tgsFruitTool: "#e06060",
  tgsHeight: "#b06fd9",
  tgsSaplings: "#b06fd9",
  tgsYield: "#b06fd9",
  bioVatFill: "#5aa7d9",
  bioVatOutputHatch: "#c9a24a",
  bioVatGlass: "#9fd3e6",
  bioVatRadio: "#7fd94a",
  bioVatShutter: "#e0a060",
};

function Term({ term }: { term: FormulaTerm }) {
  if (typeof term === "string") return <>{term}</>;
  if ("sup" in term) {
    return <sup style={term.knob ? { color: KNOB_COLORS[term.knob] } : undefined}>{term.sup}</sup>;
  }
  return <span style={{ color: KNOB_COLORS[term.knob] }}>{term.text}</span>;
}

/**
 * THE WORKED FORMULAS of a modelled machine (the Tree Growth Simulator, the Bacterial Vat): every number on the
 * card derived in front of the player with their own settings plugged in. Muted fine print, one equation per line,
 * the working right-aligned into one "=" column and the answers bright beside it, as the crop card does. Folds on
 * its head; the choice is a browser preference shared by every machine card.
 */
export function MachineFormulas({ lines }: { lines: FormulaLine[] }) {
  const t = useT();
  const [open, setOpen] = useState(readOpen);
  if (lines.length === 0) return null;
  const head = (
    <button
      type="button"
      className="flex h-[12px] w-full items-center gap-1 text-left text-[9px] uppercase tracking-wide text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
      onClick={(event) => {
        event.stopPropagation();
        setOpen((was) => {
          writeOpen(!was);
          return !was;
        });
      }}
      aria-expanded={open}
      title={open ? "Hide the worked formulas" : "Show the worked formulas"}
    >
      <ChevronDown
        aria-hidden
        className={[
          "h-2.5 w-2.5 shrink-0 transition-transform duration-100",
          open ? "" : "-rotate-90",
        ].join(" ")}
      />
      <span className="text-[9px] leading-[11px]">{t("Formulas")}</span>
    </button>
  );
  const line = (entry: FormulaLine, index: number): ReactNode => (
    <div
      key={`${index}:${entry.label}`}
      className="grid min-w-0 grid-cols-[50px_minmax(0,1fr)_auto] items-baseline gap-x-1 whitespace-nowrap"
    >
      <span className="uppercase tracking-wide">{entry.label}</span>
      <span className="min-w-0 overflow-hidden text-ellipsis text-right tabular-nums">
        {entry.math.map((term, index) => (
          <Term key={index} term={term} />
        ))}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis text-[10px] font-semibold tabular-nums text-[var(--mc-ink)]">
        {" "}
        ={" "}
        <span
          style={entry.tone ? { color: entry.tone === "good" ? "#7fd94a" : "#e06060" } : undefined}
        >
          {entry.result}
        </span>
      </span>
    </div>
  );
  return (
    <div className="mt-1 border-t border-[var(--mc-56)] pt-0.5 text-[9px] leading-[11px] text-[var(--mc-ink-muted)]">
      {head}
      {open ? <div className="mt-0.5 space-y-0.5">{lines.map(line)}</div> : null}
    </div>
  );
}
