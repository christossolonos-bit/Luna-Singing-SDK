import type { SongGenre } from "../animation/danceAnimations";

export type PerformanceSectionKind = "verse" | "chorus" | "finale" | "bridge";

export type PerformanceSection = {
  start: number;
  end: number;
  kind: PerformanceSectionKind;
  energy: number;
};

export type PerformanceMap = {
  bpm: number;
  genre: SongGenre;
  duration: number;
  sections: PerformanceSection[];
};

const WINDOW_SEC = 0.45;
const HOP_SEC = 0.2;

async function decodeAudio(source: File | Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  const arrayBuffer = await source.arrayBuffer();
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close();
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const mono = new Float32Array(length);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += channel[i] / buffer.numberOfChannels;
    }
  }

  return mono;
}

function rms(data: Float32Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp01(p) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const t = idx - lo;
  return sorted[lo]! * (1 - t) + sorted[hi]! * t;
}

function smooth(values: number[], radius: number): number[] {
  if (values.length === 0) return [];
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j < 0 || j >= values.length) continue;
      sum += values[j]!;
      count++;
    }
    out[i] = count > 0 ? sum / count : values[i]!;
  }
  return out;
}

function estimateBpmFromMono(data: Float32Array, sampleRate: number): number {
  const targetRate = 220;
  const factor = Math.max(1, Math.floor(sampleRate / targetRate));
  const length = Math.floor(data.length / factor);
  const envelope = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) {
      const sample = data[i * factor + j] ?? 0;
      sum += sample * sample;
    }
    envelope[i] = Math.sqrt(sum / factor);
  }

  let bestLag = 0;
  let bestScore = 0;
  const minLag = Math.floor((targetRate * 60) / 172);
  const maxLag = Math.floor((targetRate * 60) / 68);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = lag; i < envelope.length; i++) {
      corr += envelope[i]! * envelope[i - lag]!;
      count++;
    }
    const score = count > 0 ? corr / count : 0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return 120;
  let bpm = (targetRate * 60) / bestLag;
  while (bpm < 68) bpm *= 2;
  while (bpm > 172) bpm /= 2;
  return bpm;
}

function buildEnergyWindows(data: Float32Array, sampleRate: number): { time: number; energy: number }[] {
  const windowSamples = Math.max(1, Math.floor(WINDOW_SEC * sampleRate));
  const hopSamples = Math.max(1, Math.floor(HOP_SEC * sampleRate));
  const windows: { time: number; energy: number }[] = [];

  for (let start = 0; start + windowSamples <= data.length; start += hopSamples) {
    const slice = data.subarray(start, start + windowSamples);
    windows.push({
      time: start / sampleRate,
      energy: rms(slice),
    });
  }

  if (windows.length === 0) {
    windows.push({ time: 0, energy: rms(data) });
  }

  return windows;
}

function labelWindows(
  windows: { time: number; energy: number }[],
  duration: number,
): PerformanceSection[] {
  const energies = windows.map((w) => w.energy);
  const smoothed = smooth(energies, 2);
  const maxE = Math.max(...smoothed, 1e-6);
  const normalized = smoothed.map((e) => e / maxE);
  const median = percentile(normalized, 0.5);
  const chorusThreshold = percentile(normalized, 0.72);
  const finaleThreshold = percentile(normalized, 0.88);

  const labeled = windows.map((window, i) => {
    const energy = normalized[i]!;
    const time = window.time;
    const inOutro = time >= duration * 0.82;

    let kind: PerformanceSectionKind = "verse";
    if ((inOutro && energy >= median) || energy >= finaleThreshold) {
      kind = "finale";
    } else if (energy >= chorusThreshold) {
      kind = "chorus";
    } else if (energy >= median * 0.92) {
      kind = "bridge";
    }

    return { start: time, end: time + WINDOW_SEC, kind, energy };
  });

  const merged: PerformanceSection[] = [];
  for (const window of labeled) {
    const last = merged[merged.length - 1];
    if (last && last.kind === window.kind) {
      last.end = window.end;
      last.energy = Math.max(last.energy, window.energy);
      continue;
    }
    merged.push({ ...window });
  }

  if (merged.length > 0) {
    merged[merged.length - 1]!.end = duration;
    merged[0]!.start = 0;
  }

  return merged;
}

/** Full-track energy map for Viktor's verse / chorus / finale movement. */
export async function analyzeSongPerformance(
  source: File | Blob,
  genre: SongGenre = "pop",
  bpmHint?: number,
): Promise<PerformanceMap> {
  const buffer = await decodeAudio(source);
  const mono = mixToMono(buffer);
  const duration = buffer.duration;
  const windows = buildEnergyWindows(mono, buffer.sampleRate);
  const sections = labelWindows(windows, duration);
  const bpm = bpmHint ?? Math.round(estimateBpmFromMono(mono, buffer.sampleRate));

  return { bpm, genre, duration, sections };
}

export function sectionAtTime(
  map: PerformanceMap,
  time: number,
): PerformanceSection {
  const t = Math.max(0, Math.min(map.duration, time));
  const hit = map.sections.find((section) => t >= section.start && t < section.end);
  return hit ?? map.sections[map.sections.length - 1] ?? {
    start: 0,
    end: map.duration,
    kind: "verse",
    energy: 0.4,
  };
}
