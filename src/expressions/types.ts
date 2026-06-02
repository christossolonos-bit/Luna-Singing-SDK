export const EMOTION_NAMES = [
  "happy",
  "sad",
  "angry",
  "relaxed",
  "surprised",
  "frustrated",
  "confused",
  "neutral",
  "fear",
  "disgusted",
] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

export type EmotionWeights = Record<EmotionName, number>;

export type EmotionCue = {
  start: number;
  end: number;
  emotion: EmotionName;
  /** Optional lyric line — refines emotion via keyword sentiment. */
  text?: string;
};

export type EmotionTimeline = {
  cues: EmotionCue[];
};

export type VocalFeatures = {
  rms: number;
  centroid: number;
  peak: number;
  attack: number;
};

export const EMPTY_EMOTIONS: EmotionWeights = {
  happy: 0,
  sad: 0,
  angry: 0,
  relaxed: 0,
  surprised: 0,
  frustrated: 0,
  confused: 0,
  neutral: 0,
  fear: 0,
  disgusted: 0,
};

/** Face presets driven from EmotionWeights (frustrated is a composite, not a VRM preset). */
export type FaceExpressionWeights = {
  happy: number;
  sad: number;
  angry: number;
  relaxed: number;
  surprised: number;
};

export function toFaceExpressions(weights: EmotionWeights): FaceExpressionWeights {
  return {
    happy: weights.happy,
    sad: weights.sad + weights.frustrated * 0.35 + weights.fear * 0.15,
    angry: weights.angry + weights.frustrated * 0.55 + weights.disgusted * 0.25,
    relaxed: weights.relaxed + weights.neutral * 0.4,
    surprised: weights.surprised + weights.confused * 0.45 + weights.fear * 0.2,
  };
}
