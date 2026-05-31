import type { VocalFeatures } from "./types";

const HISTORY_SIZE = 24;

export class VocalEmotionAnalyzer {
  private readonly history: VocalFeatures[] = [];

  analyze(analyser: AnalyserNode, prevRms: number): VocalFeatures {
    const bins = analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    analyser.getByteFrequencyData(data);

    let sumSq = 0;
    let weighted = 0;
    let total = 0;
    let peak = 0;

    const sampleRate = analyser.context.sampleRate;
    const binHz = sampleRate / analyser.fftSize;

    for (let i = 0; i < bins; i++) {
      const amp = data[i] / 255;
      sumSq += amp * amp;
      weighted += i * binHz * amp;
      total += amp;
      peak = Math.max(peak, amp);
    }

    const rms = Math.sqrt(sumSq / bins);
    const centroid = total > 0 ? weighted / total : 0;
    const attack = rms - prevRms;

    const features: VocalFeatures = { rms, centroid, peak, attack };
    this.history.push(features);
    if (this.history.length > HISTORY_SIZE) {
      this.history.shift();
    }

    return features;
  }

  get variance(): number {
    if (this.history.length < 4) return 0;
    const levels = this.history.map((f) => f.rms);
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    const variance =
      levels.reduce((acc, v) => acc + (v - mean) ** 2, 0) / levels.length;
    return Math.sqrt(variance);
  }

  reset(): void {
    this.history.length = 0;
  }
}
