export type StemSources = {
  music: string | File | Blob;
  vocals: string | File | Blob;
};

export type StemMixerState = "idle" | "ready" | "playing" | "paused";

/**
 * Plays music and vocals in sync. Lip sync must tap `vocalsAnalyser` only —
 * the music path never connects to the analyser.
 */
export class StemMixer {
  private readonly ctx: AudioContext;
  private readonly musicEl: HTMLAudioElement;
  private readonly vocalsEl: HTMLAudioElement;
  private readonly musicGain: GainNode;
  private readonly vocalsGain: GainNode;
  readonly vocalsAnalyser: AnalyserNode;

  private musicSource: MediaElementAudioSourceNode | null = null;
  private vocalsSource: MediaElementAudioSourceNode | null = null;
  private objectUrls: string[] = [];
  private state: StemMixerState = "idle";
  private endedNotified = false;

  /** Fires once when both stems finish playing. */
  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.musicEl = new Audio();
    this.vocalsEl = new Audio();
    this.musicEl.preload = "auto";
    this.vocalsEl.preload = "auto";

    this.musicGain = this.ctx.createGain();
    this.vocalsGain = this.ctx.createGain();
    this.vocalsAnalyser = this.ctx.createAnalyser();
    this.vocalsAnalyser.fftSize = 2048;
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  /** Lyrics / vocal stem — the only audio lip sync should read. */
  get vocalsElement(): HTMLAudioElement {
    return this.vocalsEl;
  }

  get musicElement(): HTMLAudioElement {
    return this.musicEl;
  }

  get mixerState(): StemMixerState {
    return this.state;
  }

  get currentTime(): number {
    return this.musicEl.currentTime;
  }

  get duration(): number {
    return Math.max(this.musicEl.duration || 0, this.vocalsEl.duration || 0);
  }

  async load(sources: StemSources): Promise<number> {
    this.stop();
    this.teardownSources();
    this.revokeUrls();

    const musicUrl = await this.resolveUrl(sources.music);
    const vocalsUrl = await this.resolveUrl(sources.vocals);

    this.musicEl.src = musicUrl;
    this.vocalsEl.src = vocalsUrl;

    await Promise.all([this.waitCanPlay(this.musicEl), this.waitCanPlay(this.vocalsEl)]);

    this.buildAudioGraph();
    this.syncTo(0);
    this.state = "ready";
    return this.duration;
  }

  async play(): Promise<void> {
    if (this.state === "idle") {
      throw new Error("Load music and vocals stems before playing.");
    }

    await this.ctx.resume();

    const offset = this.state === "paused" ? this.musicEl.currentTime : 0;
    this.syncTo(offset);

    await Promise.all([this.musicEl.play(), this.vocalsEl.play()]);
    this.state = "playing";
    this.endedNotified = false;
  }

  pause(): void {
    if (this.state !== "playing") return;

    this.musicEl.pause();
    this.vocalsEl.pause();
    this.state = "paused";
  }

  stop(): void {
    this.musicEl.pause();
    this.vocalsEl.pause();
    this.syncTo(0);
    if (this.state !== "idle") {
      this.state = "ready";
    }
  }

  /** Keep vocals locked to the music stem if browser playback drifts. */
  update(): void {
    if (this.state !== "playing") return;

    if (this.musicEl.ended && this.vocalsEl.ended) {
      this.state = "ready";
      this.syncTo(0);
      if (!this.endedNotified) {
        this.endedNotified = true;
        this.onEnded?.();
      }
      return;
    }

    const drift = Math.abs(this.musicEl.currentTime - this.vocalsEl.currentTime);
    if (drift > 0.03) {
      this.vocalsEl.currentTime = this.musicEl.currentTime;
    }
  }

  /** RMS energy of the vocal stem only (0–1). Used to gate lip sync. */
  getVocalsLevel(): number {
    const bins = this.vocalsAnalyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    this.vocalsAnalyser.getByteFrequencyData(data);

    let sum = 0;
    for (let i = 0; i < bins; i++) {
      const n = data[i] / 255;
      sum += n * n;
    }
    return Math.sqrt(sum / bins);
  }

  dispose(): void {
    this.stop();
    this.teardownSources();
    this.musicEl.removeAttribute("src");
    this.vocalsEl.removeAttribute("src");
    this.musicEl.load();
    this.vocalsEl.load();
    this.revokeUrls();
    void this.ctx.close();
    this.state = "idle";
  }

  /**
   * Music → speakers only.
   * Vocals → analyser → speakers (lip sync reads analyser, never music).
   */
  private buildAudioGraph(): void {
    this.teardownSources();

    this.musicSource = this.ctx.createMediaElementSource(this.musicEl);
    this.vocalsSource = this.ctx.createMediaElementSource(this.vocalsEl);

    this.musicSource.connect(this.musicGain);
    this.musicGain.connect(this.ctx.destination);

    this.vocalsSource.connect(this.vocalsGain);
    this.vocalsGain.connect(this.vocalsAnalyser);
    this.vocalsAnalyser.connect(this.ctx.destination);
  }

  private teardownSources(): void {
    this.musicSource?.disconnect();
    this.vocalsSource?.disconnect();
    this.musicSource = null;
    this.vocalsSource = null;
  }

  private syncTo(time: number): void {
    this.musicEl.currentTime = time;
    this.vocalsEl.currentTime = time;
  }

  private async resolveUrl(source: string | File | Blob): Promise<string> {
    if (typeof source === "string") {
      return source;
    }
    const url = URL.createObjectURL(source);
    this.objectUrls.push(url);
    return url;
  }

  private revokeUrls(): void {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls = [];
  }

  private waitCanPlay(audio: HTMLAudioElement): Promise<void> {
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load audio: ${audio.src}`));
      };
      const cleanup = () => {
        audio.removeEventListener("canplay", onReady);
        audio.removeEventListener("error", onError);
      };

      audio.addEventListener("canplay", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
    });
  }
}
