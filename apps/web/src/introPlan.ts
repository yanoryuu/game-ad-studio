// Web-side preview of how the intro template attaches the info card / points to body lines (ARCHITECTURE §5.8).
// Approximation for the editor: a line counts as "placed" when it has narration input (the template only places
// synthesized lines and may drop overflowing ones in fixed-length videos).
import { hasNarrationInput, introBodyLines, stripEmphasis, type IntroPoint, type Lang, type LangLineRef, type Project, type ScriptLine } from "@gas/shared";

export const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];

export type PointPlan = {
  item: IntroPoint;
  /** position among the displayed points (0-based) */
  num: number;
  lineId: string | null;
  mode: "bound" | "auto" | "none";
  /** lineId[lang] is set but does not point at a body line with narration */
  badRef: boolean;
};

export type LineAttachment = { kind: "info" | "point"; label: string; auto: boolean };

export type IntroPlan = {
  body: ScriptLine[];
  info: {
    visible: boolean;
    lineId: string | null;
    mode: "bound" | "auto" | "none";
    badRef: boolean;
  };
  points: PointPlan[];
  /** point items skipped in this language (empty text) */
  hiddenPointIds: Set<string>;
  /** line id -> labels attached to it ("情報カード", "ポイント①") */
  byLine: Map<string, LineAttachment[]>;
};

export function introPlan(project: Project, lang: Lang): IntroPlan {
  const intro = project.templateData.intro;
  const body = introBodyLines(project, lang);
  const placed = body.filter(hasNarrationInput);
  const placedIds = new Set(placed.map((l) => l.id));
  const byLine: IntroPlan["byLine"] = new Map();
  const attach = (id: string, a: LineAttachment) => {
    const list = byLine.get(id) ?? [];
    list.push(a);
    byLine.set(id, list);
  };

  const infoVisible = intro.info.enabled && intro.info.items.some((it) => it.label[lang].trim() || it.value[lang].trim());
  const at = intro.info.atLineId?.[lang];
  let infoLine: string | null = null;
  let infoMode: IntroPlan["info"]["mode"] = "none";
  if (infoVisible) {
    if (at && placedIds.has(at)) {
      infoLine = at;
      infoMode = "bound";
    } else {
      infoLine = placed[1]?.id ?? placed[0]?.id ?? null;
      infoMode = infoLine ? "auto" : "none";
    }
    if (infoLine) attach(infoLine, { kind: "info", label: "情報カード", auto: infoMode === "auto" });
  }

  const shown = intro.points.items.filter((p) => p.text[lang].trim() !== "");
  const hiddenPointIds = new Set(intro.points.items.filter((p) => p.text[lang].trim() === "").map((p) => p.id));
  const boundLines = new Set<string>();
  const points: PointPlan[] = shown.map((item, num) => {
    const ref = item.lineId?.[lang];
    if (ref && placedIds.has(ref)) {
      boundLines.add(ref);
      return { item, num, lineId: ref, mode: "bound", badRef: false };
    }
    return { item, num, lineId: null, mode: "none", badRef: !!ref };
  });
  const candidates = placed.filter((l) => l.section === "main" && !boundLines.has(l.id) && l.id !== infoLine);
  let k = 0;
  for (const p of points) {
    if (p.mode === "bound") continue;
    const c = candidates[k++];
    if (c) {
      p.lineId = c.id;
      p.mode = "auto";
    }
  }
  for (const p of points) if (p.lineId) attach(p.lineId, { kind: "point", label: `ポイント${CIRCLED[p.num] ?? p.num + 1}`, auto: p.mode === "auto" });

  return {
    body,
    info: { visible: infoVisible, lineId: infoLine, mode: infoMode, badRef: !!at && !placedIds.has(at) },
    points,
    hiddenPointIds,
    byLine,
  };
}

/** Section label of a body line in the intro template. */
export const INTRO_SECTION_LABEL: Record<ScriptLine["section"], string> = { hook: "フック", main: "本文", cta: "CTA" };

/** "#3 本文「このゲーム神すぎ…」" */
export function bodyLineLabel(body: ScriptLine[], id: string, max = 16): string {
  const i = body.findIndex((l) => l.id === id);
  if (i < 0) return "(見つからない行)";
  const l = body[i]!;
  const t = stripEmphasis(l.text).replace(/\s+/g, " ").trim();
  const short = t ? (t.length > max ? `${t.slice(0, max)}…` : t) : l.voice.engine === "recorded" ? "(録音)" : "(未入力)";
  return `#${i + 1} ${INTRO_SECTION_LABEL[l.section]}「${short}」`;
}

/** Sets / clears the `lang` entry of a per-language line ref; returns undefined when both are empty. */
export function setLangRef(ref: LangLineRef | undefined, lang: Lang, id: string): LangLineRef | undefined {
  const next: LangLineRef = { ...ref };
  if (id) next[lang] = id;
  else delete next[lang];
  return next.ja || next.en ? next : undefined;
}

/** Problems worth a badge on the 構成 tab (intro only). */
export function introWarnings(project: Project, lang: Lang): string[] {
  if (project.template !== "intro") return [];
  const plan = introPlan(project, lang);
  const out: string[] = [];
  if (plan.info.badRef) out.push("情報カードの開始行が見つかりません");
  const lost = plan.points.filter((p) => p.mode === "none" && plan.body.some(hasNarrationInput)).length;
  if (lost) out.push(`${lost} 件のポイントに割り当てる行が足りません`);
  if (plan.points.some((p) => p.badRef)) out.push("紐付け先が見つからないポイントがあります");
  return out;
}
