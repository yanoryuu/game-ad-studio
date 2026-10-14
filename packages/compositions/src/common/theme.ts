import type { Format } from "@gas/shared";

/** Layout unit: 1 == 1px on the short side of a 1080p frame. */
export function unitFor(width: number, height: number): number {
  return Math.min(width, height) / 1080;
}

export const isVertical = (format: Format) => format === "9:16";

function parseHex(color: string): [number, number, number] | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Black or white, whichever reads better on `bg`. Non-hex colors are assumed light. */
export function readableOn(bg: string): string {
  const rgb = parseHex(bg);
  if (!rgb) return "#111111";
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111111" : "#ffffff";
}

/** `color` with alpha (hex only; other CSS colors returned unchanged). */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Thick outline for text on top of gameplay. */
export function outline(px: number, color = "rgba(0,0,0,0.9)"): string {
  const shadows: string[] = [];
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    shadows.push(`${(Math.cos(a) * px).toFixed(1)}px ${(Math.sin(a) * px).toFixed(1)}px 0 ${color}`);
  }
  return shadows.join(", ");
}
