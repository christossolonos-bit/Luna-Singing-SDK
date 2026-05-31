import type { VRM } from "@pixiv/three-vrm";
import { Lipsync, VISEMES } from "wawa-lipsync";
import type { StemMixer } from "../audio/StemMixer";
import {
  computeVowelWeights,
  EMPTY_VOWELS,
  type VowelWeights,
  VOWEL_TO_VRM,
} from "./vowelBlend";

const VOWEL_KEYS = ["aa", "ee", "ih", "oh", "ou"] as const;
type VowelKey = (typeof VOWEL_KEYS)[number];

const VOCALS_GATE = 0.05;
const MAX_VOWEL = 0.95;

type LipsyncBackend = {
  kind: "vocals-stem";
  mixer: StemMixer;
} | {
  kind: "speech";
  audio: HTMLAudioElement;
};

export class VRMVisemeDriver {
  private readonly lipsync = new Lipsync();
  private readonly weights = new Map<VowelKey, number>();
  private backend: LipsyncBackend | null = null;
  private lastViseme: VISEMES = VISEMES.sil;

  currentViseme: VISEMES = VISEMES.sil;
  isActive = false;
  vocalLevel = 0;

  constructor(private readonly vrm: VRM) {
    for (const key of VOWEL_KEYS) {
      this.weights.set(key, 0);
    }
  }

  /** Max vowel shape weight — useful for jaw openness. */
  get vowelOpenness(): number {
    return Math.max(...VOWEL_KEYS.map((k) => this.weights.get(k) ?? 0));
  }

  get vowelWeights(): Readonly<VowelWeights> {
    return {
      aa: this.weights.get("aa") ?? 0,
      ee: this.weights.get("ee") ?? 0,
      ih: this.weights.get("ih") ?? 0,
      oh: this.weights.get("oh") ?? 0,
      ou: this.weights.get("ou") ?? 0,
    };
  }

  connectVocalsStem(mixer: StemMixer): void {
    this.attachAnalyser(mixer.vocalsAnalyser, mixer.audioContext);
    this.backend = { kind: "vocals-stem", mixer };
  }

  connectSpeech(audio: HTMLAudioElement): void {
    this.lipsync.connectAudio(audio);
    this.backend = { kind: "speech", audio };
  }

  update(attackSmoothing = 0.62, releaseSmoothing = 0.38): void {
    const manager = this.vrm.expressionManager;
    if (!manager || !this.backend) {
      this.isActive = false;
      return;
    }

    if (this.backend.kind === "vocals-stem") {
      if (this.backend.mixer.mixerState !== "playing") {
        this.isActive = false;
        this.vocalLevel = 0;
        this.currentViseme = VISEMES.sil;
        this.applyVowels(EMPTY_VOWELS, releaseSmoothing);
        return;
      }

      this.vocalLevel = this.backend.mixer.getVocalsLevel();
      if (this.vocalLevel < VOCALS_GATE) {
        this.isActive = false;
        this.currentViseme = VISEMES.sil;
        this.applyVowels(EMPTY_VOWELS, releaseSmoothing);
        return;
      }

      this.isActive = true;
    } else {
      this.isActive = !this.backend.audio.paused && !this.backend.audio.ended;
      this.vocalLevel = this.isActive ? 0.25 : 0;
    }

    this.lipsync.processAudio();
    this.currentViseme = this.lipsync.viseme;
    const visemeChanged = this.currentViseme !== this.lastViseme;
    this.lastViseme = this.currentViseme;

    const targets = computeVowelWeights(this.lipsync, this.vocalLevel);
    const opening = Math.max(...Object.values(targets));
    const peak = this.peakVowel();
    let smoothing =
      opening < 0.06
        ? releaseSmoothing * 1.35
        : opening > peak
          ? attackSmoothing
          : releaseSmoothing;

    if (visemeChanged && opening > 0.08) {
      smoothing = Math.min(0.88, smoothing + 0.22);
    }

    this.applyVowels(targets, smoothing);
  }

  reset(): void {
    this.isActive = false;
    this.vocalLevel = 0;
    this.currentViseme = VISEMES.sil;
    this.lastViseme = VISEMES.sil;

    for (const key of VOWEL_KEYS) {
      this.weights.set(key, 0);
      this.vrm.expressionManager?.setValue(VOWEL_TO_VRM[key], 0);
    }
  }

  private peakVowel(): number {
    return Math.max(...VOWEL_KEYS.map((k) => this.weights.get(k) ?? 0));
  }

  private attachAnalyser(analyser: AnalyserNode, audioContext: AudioContext): void {
    const internal = this.lipsync as unknown as {
      analyser: AnalyserNode;
      audioContext: AudioContext;
      history: unknown[];
      features: null;
      state: string;
      visemeStartTime: number;
    };

    internal.analyser = analyser;
    internal.audioContext = audioContext;
    internal.history = [];
    internal.features = null;
    internal.state = "silence";
    internal.visemeStartTime = performance.now();
    void audioContext.resume();
  }

  private applyVowels(targets: VowelWeights, smoothing: number): void {
    const manager = this.vrm.expressionManager;
    if (!manager) return;

    for (const key of VOWEL_KEYS) {
      const preset = VOWEL_TO_VRM[key];
      const target = clamp(targets[key] * MAX_VOWEL);
      const current = this.weights.get(key) ?? 0;
      let next = current + (target - current) * smoothing;

      if (target < 0.05) {
        next = current * (1 - smoothing * 1.15);
      }

      this.weights.set(key, next);
      manager.setValue(preset, next);
    }
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}
