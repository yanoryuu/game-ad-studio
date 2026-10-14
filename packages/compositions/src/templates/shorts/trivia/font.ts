import { useState } from "react";
import { loadFont } from "@remotion/google-fonts/MPLUSRounded1c";
import type { Lang } from "@gas/shared";

/**
 * Title / caption font of "trivia": M PLUS Rounded 1c Black (900) — the heavy rounded gothic of the reference
 * Short. Loaded through @remotion/google-fonts exactly like common/fonts.ts (Remotion waits via delayRender),
 * but LAZILY: only when a trivia video is actually rendered (useState initializer on mount), so the other
 * templates do not download it. Japanese needs the "japanese" subset; English only "latin".
 * The family name below is the one @remotion/google-fonts registers (getInfo().fontFamily).
 */
export const TRIVIA_FAMILY_NAME = "M PLUS Rounded Onec";

export function useTriviaFont(lang: Lang): void {
  useState(() => {
    try {
      loadFont("normal", {
        weights: ["900"],
        subsets: lang === "ja" ? ["japanese", "latin"] : ["latin"],
        ignoreTooManyRequestsWarning: true,
      });
    } catch {
      // never break the render over a font: the Noto Sans JP fallback is always loaded
    }
    return true;
  });
}
