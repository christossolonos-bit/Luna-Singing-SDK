import { StemMixer, type StemSources } from "./StemMixer";
import type { VRMVisemeDriver } from "../lipsync/VRMVisemeDriver";
import type { VRMPhoneticBoneDriver } from "../lipsync/VRMPhoneticBoneDriver";
import type { VRMEmotionDriver } from "../expressions/VRMEmotionDriver";
import type { EmotionTimeline } from "../expressions/types";

export class StemPerformance {
  readonly mixer: StemMixer;
  /** Procedural performance uses expression-driven face instead of vocal emotion. */
  proceduralPerformanceMode = false;

  constructor(
    private readonly lipsync: VRMVisemeDriver,
    private readonly emotion: VRMEmotionDriver,
    private readonly phonetics: VRMPhoneticBoneDriver,
    existingMixer?: StemMixer,
  ) {
    this.mixer = existingMixer ?? new StemMixer();
  }

  async loadStems(sources: StemSources): Promise<number> {
    const duration = await this.mixer.load(sources);
    this.lipsync.connectVocalsStem(this.mixer);
    this.emotion.connectVocalsStem(this.mixer);
    return duration;
  }

  async loadStemsFromFiles(music: File, vocals: File): Promise<number> {
    return this.loadStems({ music, vocals });
  }

  async loadEmotionMap(file: File): Promise<void> {
    const raw = await file.text();
    const timeline = JSON.parse(raw) as EmotionTimeline;
    if (!Array.isArray(timeline.cues)) {
      throw new Error("Emotion map must contain a cues array.");
    }
    this.emotion.loadTimeline(timeline);
  }

  async play(): Promise<void> {
    this.lipsync.connectVocalsStem(this.mixer);
    this.emotion.connectVocalsStem(this.mixer);
    await this.mixer.play();
  }

  pause(): void {
    this.mixer.pause();
    this.lipsync.reset();
    this.emotion.reset();
    this.phonetics.reset();
  }

  togglePlayPause(): Promise<void> {
    if (this.mixer.mixerState === "playing") {
      this.pause();
      return Promise.resolve();
    }
    return this.play();
  }

  update(): void {
    this.mixer.update();

    if (this.mixer.mixerState === "playing") {
      this.lipsync.update();
      this.emotion.update(this.mixer.currentTime);
      this.phonetics.update();
    }
  }

  dispose(): void {
    this.mixer.dispose();
    this.lipsync.reset();
    this.emotion.reset();
    this.phonetics.reset();
  }
}
