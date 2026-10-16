import type { Lang, TemplateId } from "@gas/shared";
import type { TemplateDataInput } from "./templateEdit";

/**
 * make_ad defaults without any LLM: split the description into selling points and fill a short narration and the
 * template's texts from them with fixed phrases. Everything can be overridden (script / templateData inputs).
 */

export type DraftLine = { section: "hook" | "main" | "cta"; text: string };

/** Selling points: explicit list, else sentences / bullet lines of the description (max 5, trimmed). */
export function sellingPoints(description = "", explicit: string[] = []): string[] {
  const pts = explicit.map((s) => s.trim()).filter(Boolean);
  if (pts.length) return pts.slice(0, 5);
  return description
    .split(/\r?\n|(?<=[。！？!?])|(?<=\.)\s+/)
    .map((s) => s.replace(/^\s*(?:[-*・•●◆■]|\d+[.)．、])\s*/, "").trim())
    .filter((s) => s.length >= 2)
    .slice(0, 5);
}

const endPunct = (s: string, lang: Lang) => (/[。！？!?.…]$/.test(s) ? s : s + (lang === "ja" ? "！" : "!"));
/** Narration text must be speakable: no line breaks. */
const speak = (s: string) => s.replace(/\s*\n\s*/g, lang0(s) ? "" : " ").trim();
function lang0(s: string) {
  return /[぀-ヿ一-鿿]/.test(s);
}

function hookLine(t: TemplateId, title: string, lang: Lang): string {
  if (lang === "ja") {
    switch (t) {
      case "question":
        return `このゲーム、遊んでみたい？`;
      case "challenge":
        return `これ、クリアできる？`;
      case "fail-win":
        return `何度やっても失敗…でも！`;
      case "payoff":
        return `最後まで見てほしい。`;
      case "list":
        return `${title}の魅力を紹介！`;
      case "trivia":
        return `${title}というゲームを知っていますか？`;
      default:
        return `${title}、知ってる？`;
    }
  }
  switch (t) {
    case "question":
      return `Would you play this game?`;
    case "challenge":
      return `Can you beat this?`;
    case "fail-win":
      return `I kept failing... but then!`;
    case "payoff":
      return `Wait for the end.`;
    case "list":
      return `Here's why you'll love ${title}!`;
    default:
      return `Have you heard of ${title}?`;
  }
}

/** Default narration: hook phrase, up to 3 selling points, CTA with the game title. */
export function draftScript(t: TemplateId, title: string, points: string[], lang: Lang): DraftLine[] {
  const lines: DraftLine[] = [{ section: "hook", text: hookLine(t, title, lang) }];
  const n = t === "intro" || t === "list" || t === "trivia" ? 4 : 3;
  for (const p of points.slice(0, n)) lines.push({ section: "main", text: endPunct(speak(p), lang) });
  if (t !== "loop") {
    lines.push({
      section: "cta",
      text: lang === "ja" ? `${title}、ウィッシュリストに追加してね！` : `Wishlist ${title} on Steam now!`,
    });
  }
  return lines;
}

const short = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

/** Template texts from the game title + selling points (only keys the template uses). */
export function draftTemplateData(t: TemplateId, title: string, points: string[], lang: Lang): TemplateDataInput {
  const ja = lang === "ja";
  const p0 = points[0] ?? title;
  switch (t) {
    case "hook-play-cta":
      return { hookText: short(p0, 24) };
    case "features":
      return { features: (points.length >= 2 ? points : [p0, title]).slice(0, 4).map((h) => ({ heading: short(h, 20) })) };
    case "trailer":
      return {
        cards: points.slice(0, 2).map((x, i) => ({ text: short(x, 16), afterClipIndex: i * 2 + 1 })),
      };
    case "intro":
      return {
        headline: ja ? `${title}が\n【面白すぎる】んだが！` : `${title} is\n【INSANELY GOOD】`,
        points: points.slice(0, 3).map((x) => short(x, 22)),
        info: { enabled: false },
      };
    case "question":
      return { title: ja ? `${title}、\n【遊びたい】？` : `Would you play\n【${title}】?` };
    case "list":
      return {
        title: ja ? `${title}の\n【魅力】${Math.max(2, Math.min(5, points.length))}選` : `${Math.max(2, Math.min(5, points.length))} reasons to play\n【${title}】`,
        items: (points.length >= 2 ? points : [p0, title]).slice(0, 5).map((x) => short(x, 24)),
      };
    case "trivia":
      return { title: ja ? `${short(p0, 14)}\n${title}` : `${short(p0, 24)}\n${title}` };
    case "dev-pitch":
      return { title: ja ? `【一人で】${title}を\n作っています` : `I'm making\n【${title}】`, sub: "" };
    case "devlog":
      return { title: short(p0, 20), number: 0 };
    case "payoff":
    case "challenge":
    case "fail-win":
    case "before-after":
    case "comment":
    case "loop":
      return {};
  }
}
