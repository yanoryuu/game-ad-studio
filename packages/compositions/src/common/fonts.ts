import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import type { Lang } from "@gas/shared";

// Loaded at module top (Remotion waits for them via delayRender). Only the weights we use.
const noto = loadNotoSansJP("normal", { weights: ["700", "900"], subsets: ["japanese", "latin"], ignoreTooManyRequestsWarning: true });
const anton = loadAnton("normal", { weights: ["400"], subsets: ["latin"] });

/** Body / UI font (Japanese capable). */
export const BODY_FONT = `${noto.fontFamily}, sans-serif`;

/** Big display font: Anton for English (with Noto fallback), Noto Sans JP Black for Japanese. */
export function displayFont(lang: Lang): { fontFamily: string; fontWeight: number; uppercase: boolean } {
  if (lang === "en") return { fontFamily: `${anton.fontFamily}, ${noto.fontFamily}, sans-serif`, fontWeight: 400, uppercase: true };
  return { fontFamily: BODY_FONT, fontWeight: 900, uppercase: false };
}
