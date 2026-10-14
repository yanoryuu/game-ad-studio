import type { Lang, LocalizedText } from "@gas/shared";
import { cx } from "../util";
import { EmphasisField, EmphasisText } from "./Emphasis";
import { Segmented } from "./ui";

/** Shared building blocks of the template settings panels (構成 tab). */

export function LangAside(props: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <Segmented<Lang>
      size="sm"
      value={props.lang}
      onChange={props.setLang}
      ariaLabel="言語"
      options={[
        { value: "ja", label: "日本語" },
        { value: "en", label: "English" },
      ]}
    />
  );
}

export const otherLang = (l: Lang): Lang => (l === "ja" ? "en" : "ja");

/**
 * Text input for the current language + the other language's value as a dim reference.
 * `emphasisColor` set: the field gets the 【】 button and the reference renders the emphasis.
 */
export function LocalizedInput(props: {
  value: LocalizedText;
  lang: Lang;
  onChange: (v: LocalizedText) => void;
  placeholder: LocalizedText;
  ariaLabel: string;
  big?: boolean;
  multiline?: boolean;
  emphasisColor?: string;
}) {
  const o = otherLang(props.lang);
  const aria = `${props.ariaLabel}(${props.lang === "ja" ? "日本語" : "English"})`;
  const set = (v: string) => props.onChange({ ...props.value, [props.lang]: v });
  return (
    <div className="loc-input">
      {props.emphasisColor || props.multiline ? (
        <EmphasisField
          value={props.value[props.lang]}
          onChange={set}
          multiline={props.multiline}
          size={props.big ? "md" : "sm"}
          lang={props.lang}
          placeholder={props.placeholder[props.lang]}
          ariaLabel={aria}
        />
      ) : (
        <input
          className={cx("input", !props.big && "input-sm")}
          lang={props.lang}
          value={props.value[props.lang]}
          placeholder={props.placeholder[props.lang]}
          aria-label={aria}
          onChange={(e) => set(e.target.value)}
        />
      )}
      <span className={cx("loc-other", !props.value[o] && "is-empty")} lang={o}>
        <span className="lang-tag mono">{o.toUpperCase()}</span>
        {props.value[o] ? (
          props.emphasisColor ? (
            <EmphasisText text={props.value[o].replace(/\n/g, " / ")} color={props.emphasisColor} />
          ) : (
            props.value[o]
          )
        ) : (
          "未入力"
        )}
      </span>
    </div>
  );
}

export function moveItem<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function withoutKey<T extends object, K extends keyof T>(o: T, k: K): T {
  const { [k]: _omit, ...rest } = o;
  return rest as T;
}
