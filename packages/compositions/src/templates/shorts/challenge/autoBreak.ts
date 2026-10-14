import { stripEmphasis, type Lang } from "@gas/shared";

/**
 * Local helper: a long single-line text gets one "\n" near its middle so big display type can be larger
 * (BigText only breaks at explicit "\n"). ja: prefers a break after a particle / punctuation, never inside 【】;
 * en: at the space closest to the middle. Texts that already contain "\n" (or are short) are returned unchanged.
 */
export function autoBreak(text: string, lang: Lang, maxChars = lang === "ja" ? 9 : 18): string {
  if (text.includes("\n") || stripEmphasis(text).length <= maxChars) return text;
  const mid = text.length / 2;
  let best = -1;
  let bestScore = Infinity;
  let depth = 0;
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i - 1]!;
    if (c === "【") depth++;
    if (c === "】") depth--;
    if (depth > 0) continue;
    let ok: boolean;
    let bonus = 0;
    if (lang === "ja") {
      ok = !/[、。！？!?…ーっゃゅょァィゥェォッャュョ】」）]/.test(text[i]!);
      if ("はをにがでのへともや、。！？".includes(c)) bonus = -text.length * 0.3;
    } else {
      ok = text[i] === " ";
    }
    if (!ok) continue;
    const score = Math.abs(i - mid) + bonus;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return text;
  return lang === "ja" ? `${text.slice(0, best)}\n${text.slice(best)}` : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}
