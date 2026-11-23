import en from './en-US.json';
import zh from './zh-CN.json';

export type Lang = 'en' | 'zh';
export const LANGS: Lang[] = ['en', 'zh'];
export const LOCALE: Record<Lang, string> = { en: 'en-US', zh: 'zh-CN' };

/** A message: plain text with {placeholders}, or plural forms picked by Intl.PluralRules. */
export type Message = string | { one?: string; other: string };
export type Messages = Record<string, Message>;

export const MESSAGES: Record<Lang, Messages> = { en: en as Messages, zh: zh as Messages };

const plural = new Map<string, Intl.PluralRules>();

export type Params = Record<string, string | number>;

export function translate(lang: Lang, key: string, params?: Params): string {
  const m = MESSAGES[lang][key] ?? MESSAGES.en[key];
  if (m === undefined) return key;
  let s: string;
  if (typeof m === 'string') s = m;
  else {
    const n = Number(params?.n ?? 0);
    let pr = plural.get(lang);
    if (!pr) { pr = new Intl.PluralRules(LOCALE[lang]); plural.set(lang, pr); }
    const form = pr.select(n) as 'one' | 'other';
    s = (form === 'one' ? m.one : undefined) ?? m.other;
  }
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (all, k: string) => (params[k] !== undefined ? String(params[k]) : all));
}

/** Placeholder names used by a message, for the translation tests. */
/** A language's own name for itself ("English", "中文"), for the language switch. */
export function langName(lang: Lang): string {
  return translate(lang, 'lang.name');
}

export function placeholders(m: Message): string[] {
  const texts = typeof m === 'string' ? [m] : [m.one ?? '', m.other];
  const set = new Set<string>();
  for (const s of texts) for (const x of s.matchAll(/\{(\w+)\}/g)) set.add(x[1]);
  return [...set].sort();
}

/** First visit: ?lang=, then the saved choice, then the browser's language list. */
export function initialLang(search: string, saved: string | null, languages: readonly string[]): Lang {
  const q = new URLSearchParams(search).get('lang');
  if (q) return q.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  if (saved === 'en' || saved === 'zh') return saved;
  for (const l of languages) {
    const v = l.toLowerCase();
    if (v.startsWith('zh')) return 'zh';
    if (v.startsWith('en')) return 'en';
  }
  return 'en';
}
