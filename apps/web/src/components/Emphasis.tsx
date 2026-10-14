import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { EMPHASIS_CLOSE, EMPHASIS_OPEN, parseEmphasis } from "@gas/shared";
import { cx } from "../util";

/* ------------------------------------------------------------------ */
/* 【】 emphasis markup helpers (ARCHITECTURE §4.4)                      */
/* ------------------------------------------------------------------ */

type Span = { open: number; /** index of the closing 】, or null when unclosed (runs to the end) */ close: number | null };

/** Emphasis spans of `text` following parseEmphasis' rules (no nesting, stray 】 ignored, unclosed 【 → end). */
function emphasisSpans(text: string): Span[] {
  const out: Span[] = [];
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === EMPHASIS_OPEN && open < 0) open = i;
    else if (ch === EMPHASIS_CLOSE && open >= 0) {
      out.push({ open, close: i });
      open = -1;
    }
  }
  if (open >= 0) out.push({ open, close: null });
  return out;
}

/**
 * Toggles emphasis on the selection [start, end) of `value`:
 *  - caret only: inserts 【】 with the caret inside
 *  - selection inside one emphasis span: removes that span's markers (un-emphasize)
 *  - otherwise: wraps the selection (grown to cover partially selected spans, inner markers dropped)
 * Returns the new text and the selection to restore.
 */
export function toggleEmphasis(value: string, start: number, end: number): { text: string; start: number; end: number } {
  if (start > end) [start, end] = [end, start];
  const spans = emphasisSpans(value);
  const inner = spans.find((s) => s.open < start && end <= (s.close ?? value.length));
  if (inner) {
    const closeIdx = inner.close;
    let text = value;
    if (closeIdx !== null) text = text.slice(0, closeIdx) + text.slice(closeIdx + 1);
    text = text.slice(0, inner.open) + text.slice(inner.open + 1);
    return { text, start: start - 1, end: end - 1 };
  }
  if (start === end) {
    const text = value.slice(0, start) + EMPHASIS_OPEN + EMPHASIS_CLOSE + value.slice(end);
    return { text, start: start + 1, end: start + 1 };
  }
  let s = start;
  let e = end;
  for (const sp of spans) {
    const spEnd = sp.close === null ? value.length : sp.close + 1;
    if (sp.open < e && spEnd > s) {
      s = Math.min(s, sp.open);
      e = Math.max(e, spEnd);
    }
  }
  const body = value.slice(s, e).replace(/[【】]/g, "");
  // keep surrounding whitespace outside the markers
  const lead = body.match(/^\s*/)![0];
  const trail = body.slice(lead.length).match(/\s*$/)![0];
  const core = body.slice(lead.length, body.length - trail.length);
  if (!core) return { text: value, start, end };
  const text = value.slice(0, s) + lead + EMPHASIS_OPEN + core + EMPHASIS_CLOSE + trail + value.slice(e);
  const ns = s + lead.length + 1;
  return { text, start: ns, end: ns + core.length };
}

/** Renders 【emphasis】 markup: brackets hidden, emphasized runs colored (and slightly larger). Keeps "\n". */
export function EmphasisText(props: { text: string; color: string; className?: string; placeholder?: string; lang?: string }) {
  const segs = parseEmphasis(props.text);
  if (segs.length === 0) return props.placeholder ? <span className={cx("emph-text", "is-empty", props.className)}>{props.placeholder}</span> : null;
  return (
    <span className={cx("emph-text", props.className)} lang={props.lang} style={{ "--emph": props.color } as CSSProperties}>
      {segs.map((s, i) =>
        s.emph ? (
          <b key={i} className="emph">
            {s.text}
          </b>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Text input / textarea with a "【】" button (and Ctrl+B) that wraps the selection in emphasis markers.
 * The button keeps the field's focus and selection (mousedown is prevented).
 */
export function EmphasisField(props: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  className?: string;
  placeholder?: string;
  lang?: string;
  ariaLabel?: string;
  id?: string;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const sel = pendingSel.current;
    if (!el || !sel) return;
    pendingSel.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [props.value]);

  const wrap = () => {
    const el = ref.current;
    if (!el) return;
    const r = toggleEmphasis(props.value, el.selectionStart ?? props.value.length, el.selectionEnd ?? props.value.length);
    if (r.text === props.value) {
      el.focus();
      return;
    }
    pendingSel.current = [r.start, r.end];
    props.onChange(r.text);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrap();
    }
  };

  const common = {
    ref,
    id: props.id,
    lang: props.lang,
    value: props.value,
    placeholder: props.placeholder,
    "aria-label": props.ariaLabel,
    onKeyDown,
  };
  return (
    <div className={cx("emph-field", props.multiline ? "is-multi" : "is-single", props.size === "sm" && "is-sm")}>
      {props.multiline ? (
        <textarea
          {...common}
          className={cx("input textarea", props.className)}
          rows={props.rows ?? 2}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input
          {...common}
          className={cx("input", props.size === "sm" && "input-sm", props.className)}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
      <button
        type="button"
        className="emph-btn"
        tabIndex={-1}
        title="選択範囲を【】で囲む(強調)/ 強調を外す — Ctrl+B"
        aria-label="選択範囲を【】で囲む"
        onMouseDown={(e) => e.preventDefault()}
        onClick={wrap}
      >
        【】
      </button>
    </div>
  );
}
