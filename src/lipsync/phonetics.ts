import { VISEMES } from "wawa-lipsync";

export type PhoneticCategory = "silence" | "vowel" | "plosive" | "fricative";

const VISEME_CATEGORY: Record<VISEMES, PhoneticCategory> = {
  [VISEMES.sil]: "silence",
  [VISEMES.PP]: "plosive",
  [VISEMES.FF]: "fricative",
  [VISEMES.TH]: "fricative",
  [VISEMES.DD]: "plosive",
  [VISEMES.kk]: "plosive",
  [VISEMES.CH]: "fricative",
  [VISEMES.SS]: "fricative",
  [VISEMES.nn]: "plosive",
  [VISEMES.RR]: "fricative",
  [VISEMES.aa]: "vowel",
  [VISEMES.E]: "vowel",
  [VISEMES.I]: "vowel",
  [VISEMES.O]: "vowel",
  [VISEMES.U]: "vowel",
};

/** Jaw opening amount per viseme (0 = closed, 1 = fully open). */
export const JAW_OPEN_BY_VISEME: Partial<Record<VISEMES, number>> = {
  [VISEMES.sil]: 0,
  [VISEMES.aa]: 1,
  [VISEMES.E]: 0.55,
  [VISEMES.I]: 0.3,
  [VISEMES.O]: 0.85,
  [VISEMES.U]: 0.45,
  [VISEMES.PP]: 0.05,
  [VISEMES.FF]: 0.2,
  [VISEMES.TH]: 0.25,
  [VISEMES.DD]: 0.12,
  [VISEMES.kk]: 0.18,
  [VISEMES.CH]: 0.22,
  [VISEMES.SS]: 0.15,
  [VISEMES.nn]: 0.1,
  [VISEMES.RR]: 0.35,
};

/** Head pitch nudge per phonetic category (radians). */
export const HEAD_PITCH_BY_CATEGORY: Record<PhoneticCategory, number> = {
  silence: 0,
  vowel: 0.035,
  plosive: -0.015,
  fricative: 0.01,
};

export function phoneticCategory(viseme: VISEMES): PhoneticCategory {
  return VISEME_CATEGORY[viseme];
}

export function jawOpenTarget(viseme: VISEMES): number {
  return JAW_OPEN_BY_VISEME[viseme] ?? 0;
}
