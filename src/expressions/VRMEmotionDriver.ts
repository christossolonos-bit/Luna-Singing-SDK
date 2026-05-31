import { VRMExpressionPresetName, type VRM } from "@pixiv/three-vrm";
import { activeLyricAtTime, emotionFromText } from "./emotionFromText";
import { VocalEmotionAnalyzer } from "./VocalEmotionAnalyzer";
import type { StemMixer } from "../audio/StemMixer";
import {
  EMPTY_EMOTIONS,
  toFaceExpressions,
  type EmotionCue,
  type EmotionName,
  type EmotionTimeline,
  type EmotionWeights,
  type FaceExpressionWeights,
} from "./types";

const VOCALS_GATE = 0.045;
const MAX_EXPRESSION = 0.92;

const FACE_PRESETS: Record<keyof FaceExpressionWeights, string> = {
  happy: VRMExpressionPresetName.Happy,
  sad: VRMExpressionPresetName.Sad,
  angry: VRMExpressionPresetName.Angry,
  relaxed: VRMExpressionPresetName.Relaxed,
  surprised: VRMExpressionPresetName.Surprised,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function blend(a: EmotionWeights, b: EmotionWeights, t: number): EmotionWeights {
  const out = { ...EMPTY_EMOTIONS };
  for (const key of Object.keys(out) as EmotionName[]) {
    out[key] = a[key] * (1 - t) + b[key] * t;
  }
  return out;
}

function scale(weights: EmotionWeights, factor: number): EmotionWeights {
  const out = { ...EMPTY_EMOTIONS };
  for (const key of Object.keys(out) as EmotionName[]) {
    out[key] = weights[key] * factor;
  }
  return out;
}

function inferFromVocals(
  f: { rms: number; centroid: number; attack: number },
  variance: number,
): EmotionWeights {
  const { rms, centroid, attack } = f;

  if (rms < VOCALS_GATE) {
    return { ...EMPTY_EMOTIONS };
  }

  const happy = clamp01(rms * 1.15 + (centroid > 1650 ? 0.35 : 0) + (attack > 0.012 ? 0.2 : 0));
  const sad = clamp01((0.34 - rms) * 2 + (centroid < 1250 ? 0.45 : 0) + (variance < 0.02 ? 0.15 : 0));
  const angry = clamp01(
    rms * variance * 5 + (attack > 0.04 ? 0.35 : 0) + (rms > 0.18 && centroid > 1900 ? 0.25 : 0),
  );
  const relaxed = clamp01(0.45 - Math.abs(rms - 0.13) * 2.5 + (variance < 0.022 ? 0.4 : 0));
  const surprised = clamp01(attack > 0.055 ? attack * 5.5 : 0);
  const frustrated = clamp01(variance * 2.5 + (rms > 0.15 && rms < 0.28 && attack > 0.02 ? 0.35 : 0));

  return { happy, sad, angry, relaxed, surprised, frustrated };
}

export class VRMEmotionDriver {
  private readonly analyzer = new VocalEmotionAnalyzer();
  private readonly weights = new Map<string, number>();
  private readonly available: (keyof FaceExpressionWeights)[];
  private mixer: StemMixer | null = null;
  private timeline: EmotionCue[] | null = null;
  private prevRms = 0;
  private speechTargets: EmotionWeights | null = null;

  constructor(private readonly vrm: VRM) {
    const presets = vrm.expressionManager?.presetExpressionMap ?? {};
    this.available = (Object.keys(FACE_PRESETS) as (keyof FaceExpressionWeights)[]).filter(
      (e) => FACE_PRESETS[e] in presets,
    );

    for (const emotion of this.available) {
      this.weights.set(FACE_PRESETS[emotion], 0);
    }
  }

  connectVocalsStem(mixer: StemMixer): void {
    this.mixer = mixer;
    this.speechTargets = null;
    this.analyzer.reset();
    this.prevRms = 0;
  }

  setSpeechEmotion(text: string): void {
    this.mixer = null;
    this.speechTargets = scale(emotionFromText(text), MAX_EXPRESSION);
  }

  loadTimeline(timeline: EmotionTimeline): void {
    this.timeline = timeline.cues.slice().sort((a, b) => a.start - b.start);
  }

  clearTimeline(): void {
    this.timeline = null;
  }

  update(currentTime = 0, smoothing = 0.16): void {
    const manager = this.vrm.expressionManager;
    if (!manager || this.available.length === 0) return;

    let emotionTargets = { ...EMPTY_EMOTIONS };

    if (this.mixer) {
      if (this.mixer.mixerState !== "playing") {
        this.fadeAll(smoothing);
        return;
      }

      const features = this.analyzer.analyze(
        this.mixer.vocalsAnalyser,
        this.prevRms,
      );
      this.prevRms = features.rms;

      const audioEmotion = scale(inferFromVocals(features, this.analyzer.variance), 0.55);
      const lyricEmotion = this.emotionFromLyricsAtTime(currentTime);
      const cueEmotion = this.emotionFromCueAtTime(currentTime);

      emotionTargets = audioEmotion;

      if (lyricEmotion) {
        emotionTargets = blend(emotionTargets, lyricEmotion, 0.72);
      }
      if (cueEmotion) {
        emotionTargets = blend(emotionTargets, cueEmotion, 0.58);
      }
    } else if (this.speechTargets) {
      emotionTargets = this.speechTargets;
    } else {
      this.fadeAll(smoothing);
      return;
    }

    const faceTargets = toFaceExpressions(emotionTargets);

    for (const emotion of this.available) {
      const preset = FACE_PRESETS[emotion];
      const target = clamp01(faceTargets[emotion] * MAX_EXPRESSION);
      const current = this.weights.get(preset) ?? 0;
      const next = current + (target - current) * smoothing;
      this.weights.set(preset, next);
      manager.setValue(preset, next);
    }
  }

  reset(): void {
    this.analyzer.reset();
    this.prevRms = 0;
    this.speechTargets = null;

    const manager = this.vrm.expressionManager;
    if (!manager) return;

    for (const emotion of this.available) {
      const preset = FACE_PRESETS[emotion];
      this.weights.set(preset, 0);
      manager.setValue(preset, 0);
    }
  }

  private emotionFromLyricsAtTime(time: number): EmotionWeights | null {
    if (!this.timeline?.length) return null;

    const lyric = activeLyricAtTime(this.timeline, time);
    if (!lyric) return null;

    return scale(emotionFromText(lyric), MAX_EXPRESSION);
  }

  private emotionFromCueAtTime(time: number): EmotionWeights | null {
    if (!this.timeline?.length) return null;

    const cue = this.timeline.find((c) => time >= c.start && time < c.end);
    if (!cue) return null;

    let weights: EmotionWeights = {
      ...EMPTY_EMOTIONS,
      [cue.emotion]: MAX_EXPRESSION,
    };

    if (cue.text) {
      weights = blend(weights, scale(emotionFromText(cue.text), MAX_EXPRESSION), 0.55);
    }

    return weights;
  }

  private fadeAll(smoothing: number): void {
    const manager = this.vrm.expressionManager;
    if (!manager) return;

    for (const emotion of this.available) {
      const preset = FACE_PRESETS[emotion];
      const current = this.weights.get(preset) ?? 0;
      const next = current + (0 - current) * smoothing;
      this.weights.set(preset, next);
      manager.setValue(preset, next);
    }
  }
}
