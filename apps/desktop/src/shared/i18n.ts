import { EN } from './i18n-en';
import { PT } from './i18n-pt';

/**
 * Turkish strings are the source keys (they are what the code contains); English and
 * Portuguese come from their dictionaries. A missing entry falls back to the Turkish
 * text, so nothing ever renders empty.
 */
export type Lang = 'tr' | 'en' | 'pt';
export const LANGS: readonly Lang[] = ['tr', 'en', 'pt'];
export const LANG_NAMES: Record<Lang, string> = { tr: 'Türkçe', en: 'English', pt: 'Português' };
export type LangSetting = 'auto' | Lang;

export interface AppSettings {
  language: LangSetting;
}

export interface SettingsInfo {
  language: LangSetting;
  /** The language actually in use. */
  resolved: Lang;
  /** The operating system's preferred languages, most preferred first. */
  system: string[];
}

export const DEFAULT_SETTINGS: AppSettings = { language: 'auto' };

/** Automatic choice: Turkish or Portuguese if the computer prefers them, otherwise English. */
export function resolveLang(setting: LangSetting, systemLocales: readonly string[]): Lang {
  if (setting !== 'auto') return setting;
  const first = (systemLocales[0] ?? '').toLowerCase();
  return first.startsWith('tr') ? 'tr' : first.startsWith('pt') ? 'pt' : 'en';
}

export type Params = Record<string, string | number>;

export function translate(lang: Lang, text: string, params?: Params): string {
  const base = lang === 'en' ? (EN[text] ?? text) : lang === 'pt' ? (PT[text] ?? text) : text;
  return params ? base.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : base;
}

/** Locale tag for dates and numbers. */
export function localeOf(lang: Lang): string {
  return lang === 'tr' ? 'tr-TR' : lang === 'pt' ? 'pt-BR' : 'en-US';
}
