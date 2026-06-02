import type { VRM } from "@pixiv/three-vrm";
import { activeLyricAtTime, emotionFromText } from "./emotionFromText";
import {
  expressionWeightsFromText,
  listEmotionExpressions,
} from "./expressionFromText";
import { VocalEmotionAnalyzer } from "./VocalEmotionAnalyzer";
import type { StemMixer } from "../audio/StemMixer";
import {
  EMPTY_EMOTIONS,
  toFaceExpressions,
  type EmotionTimeline,
  type EmotionWeights,
} from "./types";

const VOCALS_GATE = 0.045;
const MAX_EXPRESSION = 0.92;
const SHOUT_VOCAL_THRESHOLD = 0.34;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function blendExpressionMaps(
  a: Record<string, number>,
  b: Record<string, number>,
  t: number,
): Record<string, number> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = (a[key] ?? 0) * (1 - t) + (b[key] ?? 0) * t;
  }
  return out;
}

function scaleExpressionMap(map: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = value * factor;
  }
  return out;
}

function emotionWeightsToExpressionMap(
  weights: EmotionWeights,
  expressions: readonly string[],
): Record<string, number> {
  const face = toFaceExpressions(weights);
  const out: Record<string, number> = {};

  for (const name of expressions) {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm.includes("happy")) out[name] = Math.max(out[name] ?? 0, face.happy);
    if (norm.includes("sad")) out[name] = Math.max(out[name] ?? 0, face.sad);
    if (norm.includes("angry")) out[name] = Math.max(out[name] ?? 0, face.angry);
    if (norm.includes("relaxed") || norm.includes("calm")) {
      out[name] = Math.max(out[name] ?? 0, face.relaxed);
    }
    if (norm.includes("surprised") || norm.includes("surprise")) {
      out[name] = Math.max(out[name] ?? 0, face.surprised);
    }
    if (norm.includes("confus")) out[name] = Math.max(out[name] ?? 0, weights.confused);
    if (norm.includes("neutral")) out[name] = Math.max(out[name] ?? 0, weights.neutral * 0.6);
    if (norm.includes("fear") || norm.includes("scared")) {
      out[name] = Math.max(out[name] ?? 0, weights.fear);
    }
    if (norm.includes("disgust")) out[name] = Math.max(out[name] ?? 0, weights.disgusted);
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

  return {
    happy: clamp01(rms * 1.15 + (centroid > 1650 ? 0.35 : 0) + (attack > 0.012 ? 0.2 : 0)),
    sad: clamp01((0.34 - rms) * 2 + (centroid < 1250 ? 0.45 : 0) + (variance < 0.02 ? 0.15 : 0)),
    angry: clamp01(
      rms * variance * 5 + (attack > 0.04 ? 0.35 : 0) + (rms > 0.18 && centroid > 1900 ? 0.25 : 0),
    ),
    relaxed: clamp01(0.45 - Math.abs(rms - 0.13) * 2.5 + (variance < 0.022 ? 0.4 : 0)),
    surprised: clamp01(attack > 0.055 ? attack * 5.5 : 0),
    frustrated: clamp01(variance * 2.5 + (rms > 0.15 && rms < 0.28 && attack > 0.02 ? 0.35 : 0)),
    confused: 0,
    neutral: clamp01(0.15 - Math.abs(rms - 0.12) * 2),
    fear: clamp01(attack > 0.07 && centroid > 2000 ? 0.35 : 0),
    disgusted: 0,
  };
}

export class VRMEmotionDriver {
  private readonly analyzer = new VocalEmotionAnalyzer();
  private readonly weights = new Map<string, number>();
  private readonly expressions: string[];
  private mixer: StemMixer | null = null;
  private timeline: { start: number; end: number; emotion: string; text?: string }[] | null = null;
  private prevRms = 0;
  private speechTargets: Record<string, number> | null = null;
  private lyricPriority = false;
  private shoutHoldSec = 0;

  constructor(private readonly vrm: VRM) {
    this.expressions = listEmotionExpressions(vrm);
    for (const name of this.expressions) {
      this.weights.set(name, 0);
    }
  }

  connectVocalsStem(mixer: StemMixer): void {
    this.mixer = mixer;
    this.speechTargets = null;
    this.analyzer.reset();
    this.prevRms = 0;
    this.shoutHoldSec = 0;
  }

  setLyricPriority(enabled: boolean): void {
    this.lyricPriority = enabled;
  }

  setSpeechEmotion(text: string): void {
    this.mixer = null;
    this.speechTargets = scaleExpressionMap(
      expressionWeightsFromText(text, this.expressions),
      MAX_EXPRESSION,
    );
  }

  loadTimeline(timeline: EmotionTimeline): void {
    this.timeline = timeline.cues.slice().sort((a, b) => a.start - b.start);
  }

  clearTimeline(): void {
    this.timeline = null;
  }

  update(currentTime = 0, smoothing = 0.16): void {
    const manager = this.vrm.expressionManager;
    if (!manager || this.expressions.length === 0) return;

    let targets: Record<string, number> = {};

    if (this.mixer) {
      if (this.mixer.mixerState !== "playing") {
        this.fadeAll(smoothing);
        return;
      }

      const features = this.analyzer.analyze(this.mixer.vocalsAnalyser, this.prevRms);
      this.prevRms = features.rms;

      const rawVocal = this.mixer.getVocalsLevel();
      if (rawVocal >= SHOUT_VOCAL_THRESHOLD) {
        this.shoutHoldSec += 1 / 60;
      } else {
        this.shoutHoldSec = Math.max(0, this.shoutHoldSec - 2 / 60);
      }

      const lyricText = this.lyricTextAtTime(currentTime);
      const lyricMap = lyricText
        ? scaleExpressionMap(
            expressionWeightsFromText(lyricText, this.expressions),
            MAX_EXPRESSION,
          )
        : null;
      const cueMap = this.expressionFromCueAtTime(currentTime);

      const audioMap = scaleExpressionMap(
        emotionWeightsToExpressionMap(
          inferFromVocals(features, this.analyzer.variance),
          this.expressions,
        ),
        this.lyricPriority ? 0.22 : 0.55,
      );

      if (this.lyricPriority && (lyricMap || cueMap)) {
        targets = { ...audioMap };
        if (cueMap) {
          targets = blendExpressionMaps(targets, cueMap, 0.72);
        }
        if (lyricMap) {
          targets = blendExpressionMaps(targets, lyricMap, 0.88);
        }
      } else {
        targets = { ...audioMap };
        if (lyricMap) {
          targets = blendExpressionMaps(targets, lyricMap, 0.72);
        }
        if (cueMap) {
          targets = blendExpressionMaps(targets, cueMap, 0.58);
        }
      }

      this.applyShoutBlink(targets, rawVocal);
    } else if (this.speechTargets) {
      targets = { ...this.speechTargets };
    } else {
      this.fadeAll(smoothing);
      return;
    }

    for (const name of this.expressions) {
      const target = clamp01((targets[name] ?? 0) * MAX_EXPRESSION);
      const current = this.weights.get(name) ?? 0;
      const next = current + (target - current) * smoothing;
      this.weights.set(name, next);
      manager.setValue(name, next);
    }
  }

  reset(): void {
    this.analyzer.reset();
    this.prevRms = 0;
    this.shoutHoldSec = 0;
    this.speechTargets = null;

    const manager = this.vrm.expressionManager;
    if (!manager) return;

    for (const name of this.expressions) {
      this.weights.set(name, 0);
      manager.setValue(name, 0);
    }
  }

  private lyricTextAtTime(time: number): string | null {
    if (!this.timeline?.length) return null;
    return activeLyricAtTime(this.timeline, time);
  }

  private expressionFromCueAtTime(time: number): Record<string, number> | null {
    if (!this.timeline?.length) return null;

    const cue = this.timeline.find((c) => time >= c.start && time < c.end);
    if (!cue) return null;

    const fromEmotion = emotionWeightsToExpressionMap(
      { ...EMPTY_EMOTIONS, [cue.emotion]: 1 } as EmotionWeights,
      this.expressions,
    );

    if (!cue.text) {
      return scaleExpressionMap(fromEmotion, MAX_EXPRESSION);
    }

    const fromText = expressionWeightsFromText(cue.text, this.expressions);
    return scaleExpressionMap(
      blendExpressionMaps(fromEmotion, fromText, 0.55),
      MAX_EXPRESSION,
    );
  }

  private applyShoutBlink(targets: Record<string, number>, rawVocal: number): void {
    if (this.shoutHoldSec < 0.35) return;

    const amount = clamp01((rawVocal - SHOUT_VOCAL_THRESHOLD) * 2.2 + this.shoutHoldSec * 0.35);
    for (const name of this.expressions) {
      const norm = name.toLowerCase();
      if (norm.includes("blink")) {
        targets[name] = Math.max(targets[name] ?? 0, amount * 0.85);
      }
    }
  }

  private fadeAll(smoothing: number): void {
    const manager = this.vrm.expressionManager;
    if (!manager) return;

    for (const name of this.expressions) {
      const current = this.weights.get(name) ?? 0;
      const next = current + (0 - current) * smoothing;
      this.weights.set(name, next);
      manager.setValue(name, next);
    }
  }
}
