import { resolveLunaVoice } from "./lunaVoiceConfig";
import type { VRMEmotionDriver } from "../expressions/VRMEmotionDriver";
import type { VRMPhoneticBoneDriver } from "../lipsync/VRMPhoneticBoneDriver";
import type { VRMVisemeDriver } from "../lipsync/VRMVisemeDriver";

export type LunaSpeakOptions = {
  lang?: string;
};

export class LunaTTS {
  private readonly audio = new Audio();
  private objectUrl: string | null = null;
  private speaking = false;

  constructor(
    private readonly lipsync: VRMVisemeDriver,
    private readonly emotion: VRMEmotionDriver,
    private readonly phonetics: VRMPhoneticBoneDriver,
  ) {
    this.audio.addEventListener("ended", () => {
      this.speaking = false;
      this.lipsync.reset();
      this.emotion.reset();
      this.phonetics.reset();
      this.revokeUrl();
    });
    this.audio.addEventListener("pause", () => {
      if (this.audio.ended) return;
      this.speaking = false;
      this.lipsync.reset();
      this.emotion.reset();
      this.phonetics.reset();
    });
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get audioElement(): HTMLAudioElement {
    return this.audio;
  }

  async speak(text: string, options: LunaSpeakOptions = {}): Promise<void> {
    this.stop();

    const lang = options.lang ?? "auto";
    const response = await fetch("/api/tts/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `TTS failed (${response.status})`);
    }

    const blob = await response.blob();
    this.revokeUrl();
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;

    this.emotion.setSpeechEmotion(text);
    this.lipsync.connectSpeech(this.audio);
    await this.audio.play();
    this.speaking = true;
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.speaking = false;
    this.lipsync.reset();
    this.emotion.reset();
    this.phonetics.reset();
    this.revokeUrl();
  }

  update(): void {
    if (this.speaking && !this.audio.paused) {
      this.lipsync.update();
      this.emotion.update();
      this.phonetics.update();
    }
  }

  dispose(): void {
    this.stop();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  /** Voice id that will be used for a given language code. */
  static voiceForLang(lang = "auto"): string {
    return resolveLunaVoice(lang);
  }

  private revokeUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
