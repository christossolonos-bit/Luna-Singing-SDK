/** Luna's default Edge TTS voice — multilingual female neural. */
export const LUNA_DEFAULT_VOICE = "en-US-AvaMultilingualNeural";

/** Locale-specific Luna voices (female neural). "auto" uses the multilingual default. */
export const LUNA_VOICES: Record<string, string> = {
  auto: LUNA_DEFAULT_VOICE,
  en: "en-US-AvaMultilingualNeural",
  es: "es-ES-ElviraNeural",
  fr: "fr-FR-DeniseNeural",
  de: "de-DE-KatjaNeural",
  ja: "ja-JP-NanamiNeural",
  ko: "ko-KR-SunHiNeural",
  zh: "zh-CN-XiaoxiaoNeural",
  pt: "pt-BR-FranciscaNeural",
  it: "it-IT-ElsaNeural",
  ru: "ru-RU-SvetlanaNeural",
  ar: "ar-SA-ZariyahNeural",
  hi: "hi-IN-SwaraNeural",
};

export const LUNA_LANGUAGE_OPTIONS = [
  { code: "auto", label: "Auto (multilingual)" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
] as const;

export function resolveLunaVoice(lang = "auto"): string {
  return LUNA_VOICES[lang] ?? LUNA_DEFAULT_VOICE;
}
