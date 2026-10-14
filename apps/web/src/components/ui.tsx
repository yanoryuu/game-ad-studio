import type { ReactNode } from "react";
import { cx } from "../util";

export function Segmented<T extends string | number | null>(props: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div className={cx("seg", props.size === "sm" && "seg-sm")} role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={cx("seg-btn", o.value === props.value && "is-active")}
          disabled={o.disabled}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field(props: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
      {props.hint ? <div className="field-hint">{props.hint}</div> : null}
    </div>
  );
}

export function Section(props: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("section", props.className)}>
      <header className="section-head">
        <h2 className="section-title">{props.title}</h2>
        {props.aside ? <div className="section-aside">{props.aside}</div> : null}
      </header>
      <div className="section-body">{props.children}</div>
    </section>
  );
}

export function Spinner(props: { size?: number }) {
  const s = props.size ?? 14;
  return <span className="spinner" style={{ width: s, height: s }} aria-hidden />;
}

export function Empty(props: { icon?: ReactNode; title: ReactNode; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("empty", props.compact && "empty-compact")}>
      {props.icon ? <div className="empty-icon">{props.icon}</div> : null}
      <div className="empty-title">{props.title}</div>
      {props.children ? <div className="empty-body">{props.children}</div> : null}
    </div>
  );
}

export function Banner(props: { tone: "error" | "warn" | "info"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx("banner", `banner-${props.tone}`)} role={props.tone === "error" ? "alert" : "status"}>
      <div className="banner-text">{props.children}</div>
      {props.action}
    </div>
  );
}

export function Tabs<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode; badge?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === props.value}
          className={cx("tab", o.value === props.value && "is-active")}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
          {o.badge != null && o.badge !== false ? <span className="tab-badge">{o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("switch", props.disabled && "is-disabled")}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{props.label}</span>
    </label>
  );
}

/** Labelled range slider with a formatted value readout. */
export function Slider(props: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  hint?: ReactNode;
  title?: string;
}) {
  return (
    <div className={cx("slider", props.disabled && "is-disabled")} title={props.title}>
      <div className="slider-head">
        <span className="field-label">{props.label}</span>
        <span className="mono slider-val">{props.format ? props.format(props.value) : props.value}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-label={typeof props.label === "string" ? props.label : undefined}
      />
      {props.hint ? <div className="field-hint">{props.hint}</div> : null}
    </div>
  );
}

/** Thin horizontal 0..1 bar. */
export function Meter(props: { value: number; tone?: "accent" | "scene" | "motion" | "loud"; title?: string }) {
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <span className={cx("meter", `meter-${props.tone ?? "accent"}`)} title={props.title}>
      <span style={{ width: `${v * 100}%` }} />
    </span>
  );
}

/* --- icons (inline, stroke-based, 16px grid) --- */
type IconProps = { size?: number };
const svg = (path: ReactNode, size = 16) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {path}
  </svg>
);
export const Icon = {
  Plus: ({ size }: IconProps) => svg(<path d="M8 3v10M3 8h10" />, size),
  Up: ({ size }: IconProps) => svg(<path d="M4 10l4-4 4 4" />, size),
  Down: ({ size }: IconProps) => svg(<path d="M4 6l4 4 4-4" />, size),
  Next: ({ size }: IconProps) => svg(<path d="M6 4l4 4-4 4" />, size),
  Trash: ({ size }: IconProps) =>
    svg(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />, size),
  Edit: ({ size }: IconProps) => svg(<path d="M10.5 2.5l3 3L6 13H3v-3z" />, size),
  Play: ({ size }: IconProps) => svg(<path d="M5 3.5v9l7-4.5z" fill="currentColor" />, size),
  Pause: ({ size }: IconProps) => svg(<path d="M5 3.5v9M11 3.5v9" strokeWidth="2" />, size),
  Film: ({ size }: IconProps) =>
    svg(
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M5 3v10M11 3v10M2 6h3M2 10h3M11 6h3M11 10h3" />
      </>,
      size,
    ),
  Scissors: ({ size }: IconProps) =>
    svg(
      <>
        <circle cx="4.5" cy="4.5" r="2" />
        <circle cx="4.5" cy="11.5" r="2" />
        <path d="M6.2 5.7L13 12M6.2 10.3L13 4" />
      </>,
      size,
    ),
  Export: ({ size }: IconProps) => svg(<path d="M8 10V2.5M5 5.5l3-3 3 3M3 9.5v3.5h10V9.5" />, size),
  Back: ({ size }: IconProps) => svg(<path d="M10 3L5 8l5 5" />, size),
  Check: ({ size }: IconProps) => svg(<path d="M3 8.5l3 3 7-7" />, size),
  Alert: ({ size }: IconProps) => svg(<path d="M8 2L1.5 13.5h13zM8 6.5v3.2M8 11.6v.2" />, size),
  Image: ({ size }: IconProps) =>
    svg(
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <circle cx="6" cy="6.5" r="1.2" />
        <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
      </>,
      size,
    ),
  Plug: ({ size }: IconProps) => svg(<path d="M6 2v3M10 2v3M4 5h8v2.5a4 4 0 01-8 0zM8 11.5V14" />, size),
  Grip: ({ size }: IconProps) =>
    svg(
      <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" strokeWidth="2.2" />,
      size,
    ),
  External: ({ size }: IconProps) => svg(<path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v4h-9v-9h4" />, size),
  Sparkle: ({ size }: IconProps) =>
    svg(<path d="M8 1.8l1.5 4.2 4.3 1.5-4.3 1.5L8 13.2 6.5 9 2.2 7.5 6.5 6zM13 11.5v3M11.5 13h3" />, size),
  Wand: ({ size }: IconProps) => svg(<path d="M2.5 13.5l8-8M9 4l3 3M12 1.8v2M13 2.8h-2M14 6.5v1.5M14.75 7.25h-1.5" />, size),
  Mic: ({ size }: IconProps) =>
    svg(
      <>
        <rect x="5.5" y="1.8" width="5" height="8" rx="2.5" />
        <path d="M3.2 7.5a4.8 4.8 0 009.6 0M8 12.3v2" />
      </>,
      size,
    ),
  Music: ({ size }: IconProps) =>
    svg(
      <>
        <path d="M6 12V3.2l7-1.4v8.7" />
        <circle cx="4.3" cy="12" r="1.8" />
        <circle cx="11.3" cy="10.5" r="1.8" />
      </>,
      size,
    ),
  Speaker: ({ size }: IconProps) => svg(<path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11 5.5a3.5 3.5 0 010 5M12.8 3.5a6 6 0 010 9" />, size),
  Stop: ({ size }: IconProps) => svg(<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />, size),
  Refresh: ({ size }: IconProps) => svg(<path d="M13 3v3.5H9.5M3 13V9.5h3.5M12.6 6.5A5 5 0 004 5M3.4 9.5A5 5 0 0012 11" />, size),
  Close: ({ size }: IconProps) => svg(<path d="M4 4l8 8M12 4l-8 8" />, size),
  Pulse: ({ size }: IconProps) => svg(<path d="M1.5 8h2.5l1.5-4 2.5 8 2-6 1 2h3.5" />, size),
  Copy: ({ size }: IconProps) =>
    svg(
      <>
        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
        <path d="M10.5 5.5V3.8A1.3 1.3 0 009.2 2.5H3.8a1.3 1.3 0 00-1.3 1.3v5.4a1.3 1.3 0 001.3 1.3h1.7" />
      </>,
      size,
    ),
  Upload: ({ size }: IconProps) => svg(<path d="M8 11V2.8M4.8 5.8L8 2.6l3.2 3.2M2.8 10.5v2.7h10.4v-2.7" />, size),
  Crop: ({ size }: IconProps) => svg(<path d="M4 1.5V12h10.5M1.5 4H12v10.5" />, size),
  Caption: ({ size }: IconProps) =>
    svg(
      <>
        <rect x="1.8" y="3" width="12.4" height="10" rx="1.5" />
        <path d="M4.5 10h3M9.5 10h2M4.5 7.5h7" />
      </>,
      size,
    ),
};
