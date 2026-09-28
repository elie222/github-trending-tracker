import type { Language, ListKind, Period } from "./types.ts";

export interface ListSpec {
  list: ListKind;
  language: Language;
  period: Period;
  pageUrl: string;
}

const LANGUAGES: Language[] = ["typescript", "all"];
const PERIODS: Period[] = ["daily", "weekly", "monthly"];

export function seriesKey(list: ListKind, language: Language, period: Period): string {
  return `${list}-${language}-${period}`;
}

export function seriesTitle(list: ListKind, language: Language, period: Period): string {
  const lang = language === "typescript" ? "TypeScript" : "all languages";
  const kind = list === "developers" ? "developers" : "repositories";
  return `${lang} ${kind} (${period})`;
}

export function trendingUrl(list: ListKind, language: Language, period: Period): string {
  if (list === "repos") {
    const base = language === "all" ? "https://github.com/trending" : "https://github.com/trending/typescript";
    return `${base}?since=${period}`;
  }
  const base =
    language === "all"
      ? "https://github.com/trending/developers"
      : "https://github.com/trending/developers/typescript";
  return `${base}?since=${period}`;
}

export function allListSpecs(): ListSpec[] {
  const specs: ListSpec[] = [];
  for (const list of ["developers", "repos"] as const) {
    for (const language of LANGUAGES) {
      for (const period of PERIODS) {
        specs.push({ list, language, period, pageUrl: trendingUrl(list, language, period) });
      }
    }
  }
  return specs;
}

/** Daily lists first. TypeScript before all languages. Developers before repositories. */
export const PROMINENT_DAILY: Array<{ list: ListKind; language: Language; period: "daily" }> = [
  { list: "developers", language: "typescript", period: "daily" },
  { list: "developers", language: "all", period: "daily" },
  { list: "repos", language: "typescript", period: "daily" },
  { list: "repos", language: "all", period: "daily" },
];
