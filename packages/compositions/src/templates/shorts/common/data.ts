import {
  createDefaultShortFormData,
  stripEmphasis,
  type Lang,
  type LocalizedText,
  type Project,
  type ShortFormData,
  type ShortTemplateId,
} from "@gas/shared";

/**
 * Data access for the short-form templates (templateData.shorts[id], ARCHITECTURE §5.10). Field meanings per
 * template: SHORT_TEMPLATE_META in @gas/shared. Rule: "" (or only 【】/spaces) = the element is not shown.
 */

/** templateData.shorts[id] (falls back to the defaults if a project somehow lacks it — never throws). */
export function shortData(project: Project, id: ShortTemplateId): ShortFormData {
  return project.templateData.shorts?.[id] ?? createDefaultShortFormData(id);
}

/** true if `text` would show something (ignores 【】 markers and whitespace). */
export const hasText = (text: string | null | undefined): text is string => !!text && stripEmphasis(text).trim() !== "";

/** Localized text of `lang`, trimmed; "" when it would show nothing. Keeps 【emphasis】 and "\n" for RichText. */
export function textOf(t: LocalizedText | null | undefined, lang: Lang): string {
  const s = t?.[lang] ?? "";
  return hasText(s) ? s.trim() : "";
}

/** Non-empty items of `lang` in order (id + rich text). */
export function itemsOf(data: ShortFormData, lang: Lang): { id: string; text: string }[] {
  return data.items.map((it) => ({ id: it.id, text: textOf(it.text, lang) })).filter((it) => it.text !== "");
}

/** texts[lang].cta (trimmed, plain), or "". */
export function ctaText(project: Project, lang: Lang): string {
  return stripEmphasis(project.texts[lang]?.cta ?? "").trim();
}

/** Game title (falls back to the project name). */
export const gameTitle = (project: Project) => project.game.title.trim() || project.name;
