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
};
