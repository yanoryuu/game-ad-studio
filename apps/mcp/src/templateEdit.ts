import { z } from "zod";
import {
  createDefaultShortFormData,
  isShortTemplate,
  langSchema,
  SHORT_TEMPLATE_META,
  templateIdSchema,
  type Lang,
  type LocalizedText,
  type Project,
  type TemplateId,
} from "@gas/shared";

/**
 * set_template_data: one input shape for all templates; keys that the target template does not use are rejected
 * with a message that lists the valid ones. Text = plain string (-> `lang`, default the project's first language)
 * or { ja?, en? } (missing languages keep their current value).
 */

export const textInput = z
  .union([z.string(), z.object({ ja: z.string().optional(), en: z.string().optional() })])
  .describe('Plain string (applies to `lang`) or {"ja": "...", "en": "..."}. 【強調】 = emphasis color, "\\n" = line break.');
export type TextInput = z.infer<typeof textInput>;

export const templateDataInput = z
  .object({
    // short-form templates (SHORT_TEMPLATE_META says what each means per template)
    title: textInput.optional().describe("shorts: main text (question / challenge / headline / comment ...)"),
    sub: textInput.optional().describe("shorts: secondary text (label / handle / prompt ...)"),
    note: textInput.optional().describe("shorts: tertiary text (payoff word / after-label / reply ...)"),
    items: z
      .array(textInput)
      .max(6)
      .optional()
      .describe("shorts: list entries / poll options; features: headings (use `features` for heading+sub)"),
    number: z.number().int().min(0).max(9999).optional().describe("shorts: integer (devlog DAY, challenge timer sec; 0 = off)"),
    flag: z.boolean().optional().describe("shorts: boolean option (meaning per template, see list_templates)"),
    // intro
    headline: textInput.optional().describe("intro: persistent headline band"),
    kicker: textInput.optional().describe("intro: small label above the headline, e.g. 今話題 / TRENDING"),
    info: z
      .object({
        enabled: z.boolean().optional(),
        durationSec: z.number().min(0.5).max(20).optional(),
        items: z.array(z.object({ label: textInput, value: textInput })).max(6).optional(),
      })
      .optional()
      .describe("intro: game info card (genre / price / platforms / release ...)"),
    points: z.array(textInput).max(5).optional().describe("intro: numbered recommended points ①②③ (max 5)"),
    clipPerLine: z.boolean().optional().describe("intro: switch clip on every narration line (default true)"),
    // features
    features: z
      .array(z.object({ heading: textInput, sub: textInput.optional() }))
      .max(4)
      .optional()
      .describe("features: 2-4 selling points (heading + optional sub)"),
    // trailer
    cards: z
      .array(z.object({ text: textInput, afterClipIndex: z.number().int().min(-1).describe("show after cut N (0-based), -1 = before the first cut") }))
      .optional()
      .describe("trailer: big text cards between cuts"),
    beatSync: z.boolean().optional().describe("trailer: snap cuts to BGM beats"),
    logoReveal: z.boolean().optional().describe("trailer: logo/title reveal before the end card"),
    // classic hook-play-cta (+ common)
    hookText: textInput.optional().describe("hook-play-cta: big hook text (texts.hook)"),
    cta: textInput.optional().describe("all templates: end-card call to action (texts.cta), default ウィッシュリストに追加 / Wishlist now on Steam"),
  })
  .strict();
export type TemplateDataInput = z.infer<typeof templateDataInput>;

const SHORT_KEYS = ["title", "sub", "note", "items", "number", "flag"] as const;
const KEYS_BY_KIND: Record<string, readonly string[]> = {
  intro: ["headline", "kicker", "info", "points", "clipPerLine"],
  features: ["features", "items"],
  trailer: ["cards", "beatSync", "logoReveal"],
  "hook-play-cta": ["hookText"],
};
const COMMON_KEYS = ["cta", "hookText"];

export function allowedKeys(t: TemplateId): string[] {
  if (isShortTemplate(t)) {
    const f = SHORT_TEMPLATE_META[t].fields;
    return [...SHORT_KEYS.filter((k) => f[k]), ...COMMON_KEYS];
  }
  return [...new Set([...(KEYS_BY_KIND[t] ?? []), ...COMMON_KEYS])];
}

/** Localized text from an input, keeping `prev` for languages not given. */
export function toLocalized(v: TextInput, lang: Lang, prev: LocalizedText = { ja: "", en: "" }): LocalizedText {
  if (typeof v === "string") return { ...prev, [lang]: v };
  return { ja: v.ja ?? prev.ja, en: v.en ?? prev.en };
}

/** Localized text for a NEW list entry: missing languages fall back to `prev`, then to the given text. */
function toLocalizedItem(v: TextInput, lang: Lang, prev?: LocalizedText): LocalizedText {
  const base = toLocalized(v, lang, prev ?? { ja: "", en: "" });
  const given = typeof v === "string" ? v : (v.ja ?? v.en ?? "");
  return { ja: base.ja || (prev ? prev.ja : given), en: base.en || (prev ? prev.en : given) };
}

/**
 * Applies `data` to `p` for template `t` (mutates). Returns warnings (e.g. item count outside the template's range).
 * Throws an Error listing the valid keys when a key does not apply to the template.
 */
export function applyTemplateData(p: Project, t: TemplateId, data: TemplateDataInput, lang: Lang): string[] {
  const warnings: string[] = [];
  const allowed = allowedKeys(t);
  const given = Object.keys(data).filter((k) => data[k as keyof TemplateDataInput] !== undefined);
  const bad = given.filter((k) => !allowed.includes(k));
  if (bad.length) {
    throw new Error(`Template "${t}" does not use: ${bad.join(", ")}. Valid keys for ${t}: ${allowed.join(", ")} (see list_templates).`);
  }
  if (data.cta !== undefined) {
    const v = toLocalized(data.cta, lang, { ja: p.texts.ja.cta, en: p.texts.en.cta });
    p.texts.ja.cta = v.ja;
    p.texts.en.cta = v.en;
  }
  if (data.hookText !== undefined) {
    const v = toLocalized(data.hookText, lang, { ja: p.texts.ja.hook, en: p.texts.en.hook });
    p.texts.ja.hook = v.ja;
    p.texts.en.hook = v.en;
  }
  if (isShortTemplate(t)) {
    const d = (p.templateData.shorts[t] ??= createDefaultShortFormData(t));
    if (data.title !== undefined) d.title = toLocalized(data.title, lang, d.title);
    if (data.sub !== undefined) d.sub = toLocalized(data.sub, lang, d.sub);
    if (data.note !== undefined) d.note = toLocalized(data.note, lang, d.note);
    if (data.number !== undefined) d.number = data.number;
    if (data.flag !== undefined) d.flag = data.flag;
    if (data.items !== undefined) {
      d.items = data.items.map((v, i) => ({ id: `item_${i + 1}`, text: toLocalizedItem(v, lang, d.items[i]?.text) }));
    }
    const f = SHORT_TEMPLATE_META[t].fields;
    if (f.items && (d.items.length < f.items.min || d.items.length > f.items.max)) {
      warnings.push(`${t}: ${f.items.label} should have ${f.items.min}-${f.items.max} entries (now ${d.items.length})`);
    }
    if (f.number && (d.number < f.number.min || d.number > f.number.max)) {
      warnings.push(`${t}: ${f.number.label} should be ${f.number.min}-${f.number.max}`);
    }
    return warnings;
  }
  if (t === "intro") {
    const d = p.templateData.intro;
    if (data.headline !== undefined) d.headline = toLocalized(data.headline, lang, d.headline);
    if (data.kicker !== undefined) d.kicker = toLocalized(data.kicker, lang, d.kicker ?? { ja: "", en: "" });
    if (data.clipPerLine !== undefined) d.clipPerLine = data.clipPerLine;
    if (data.info) {
      if (data.info.enabled !== undefined) d.info.enabled = data.info.enabled;
      if (data.info.durationSec !== undefined) d.info.durationSec = data.info.durationSec;
      if (data.info.items) {
        d.info.items = data.info.items.map((it, i) => ({
          id: `info_${i + 1}`,
          label: toLocalizedItem(it.label, lang, d.info.items[i]?.label),
          value: toLocalizedItem(it.value, lang, d.info.items[i]?.value),
        }));
      }
    }
    if (data.points) {
      d.points.items = data.points.map((v, i) => ({ id: `point_${i + 1}`, text: toLocalizedItem(v, lang, d.points.items[i]?.text) }));
    }
    return warnings;
  }
  if (t === "features") {
    const d = p.templateData.features;
    const list: { heading: TextInput; sub?: TextInput }[] | undefined = data.features ?? data.items?.map((h) => ({ heading: h }));
    if (list) {
      d.items = list.map((it, i) => {
        const prev = d.items[i];
        const sub = it.sub !== undefined ? toLocalizedItem(it.sub, lang, prev?.sub) : prev?.sub;
        return { id: `feat_${i + 1}`, heading: toLocalizedItem(it.heading, lang, prev?.heading), ...(sub ? { sub } : {}) };
      });
      if (d.items.length < 2) warnings.push("features: 2-4 items recommended");
    }
    // clips/lines pointing at items that no longer exist fall back to round-robin / unbound (harmless)
    return warnings;
  }
  if (t === "trailer") {
    const d = p.templateData.trailer;
    if (data.beatSync !== undefined) d.beatSync = data.beatSync;
    if (data.logoReveal !== undefined) d.logoReveal = data.logoReveal;
    if (data.cards) {
      d.cards = data.cards.map((c, i) => ({ id: `card_${i + 1}`, text: toLocalizedItem(c.text, lang, d.cards[i]?.text), afterClipIndex: c.afterClipIndex }));
    }
    return warnings;
  }
  return warnings;
}

export const templateIdInput = templateIdSchema.describe(
  "hook-play-cta | features | trailer | intro | question | challenge | fail-win | payoff | before-after | devlog | dev-pitch | loop | list | comment | trivia",
);
export const langInput = langSchema.describe("ja | en");
