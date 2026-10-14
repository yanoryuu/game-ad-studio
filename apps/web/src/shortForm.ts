import { createDefaultShortFormData, SHORT_TEMPLATE_META, type Project, type ShortFormData, type ShortTemplateId } from "@gas/shared";

/** templateData.shorts[id], falling back to the template's defaults (older data / not yet migrated). */
export function shortData(project: Project, id: ShortTemplateId): ShortFormData {
  return project.templateData.shorts?.[id] ?? createDefaultShortFormData(id);
}

/** Problems worth a badge on the 構成 tab (short-form templates, ARCHITECTURE §5.10). */
export function shortWarnings(project: Project, id: ShortTemplateId): string[] {
  const f = SHORT_TEMPLATE_META[id].fields.items;
  if (!f) return [];
  const n = shortData(project, id).items.length;
  if (n < f.min) return [`${f.label}が ${f.min} 個に足りません`];
  if (n > f.max) return [`${f.label}が ${f.max} 個を超えています`];
  return [];
}
