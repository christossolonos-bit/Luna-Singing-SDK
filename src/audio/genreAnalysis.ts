import {
  type SongGenre,
  GENRE_LABELS,
  danceUrlsForGenre,
} from "../animation/danceAnimations";

export type GenreAnalysis = {
  genre: SongGenre;
  label: string;
  confidence: number;
  bpm: number;
  energy: number;
  danceUrls: string[];
};

type AudioFeatures = {
  bpm: number;
  energy: number;
  bassRatio: number;
  midRatio: number;
  highRatio: number;
  beatRegularity: number;
};

const ANALYSIS_SECONDS = 28;
const ANALYSIS_START_RATIO = 0.12;

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

function sliceForAnalysis(data: Float32Array, sampleRate: number): Float32Array {
  const start = Math.floor(data.length * ANALYSIS_START_RATIO);
  const length = Math.min(Math.floor(ANALYSIS_SECONDS * sampleRate), data.length - start);
  return data.subarray(start, start + length);
}

function rms(data: Float32Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
}

/** Simple low-pass for rough bass / treble split. */
function lowPass(data: Float32Array, cutoffRatio: number): Float32Array {
  const out = new Float32Array(data.length);
  const alpha = Math.exp(-2 * Math.PI * cutoffRatio);
  out[0] = data[0] ?? 0;

  for (let i = 1; i < data.length; i++) {
    out[i] = alpha * out[i - 1] + (1 - alpha) * data[i];
  }

  return out;
}

function spectralSplit(data: Float32Array): {
  bassRatio: number;
  midRatio: number;
  highRatio: number;
} {
  const low = lowPass(data, 0.04);
  const mid = lowPass(data, 0.14);

  const bassE = rms(low);
  const midE = Math.max(0, rms(mid) - bassE);
  let highSum = 0;
  for (let i = 0; i < data.length; i++) {
    const h = data[i] - mid[i];
    highSum += h * h;
  }
  const highE = Math.sqrt(highSum / Math.max(1, data.length));
  const total = bassE + midE + highE + 1e-6;

  return {
    bassRatio: bassE / total,
    midRatio: midE / total,
    highRatio: highE / total,
  };
}

function estimateBpm(data: Float32Array, sampleRate: number): number {
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

  const smooth = lowPass(envelope, 0.08);
  let bestLag = 0;
  let bestScore = 0;

  const minBpm = 68;
  const maxBpm = 172;
  const minLag = Math.floor((targetRate * 60) / maxBpm);
  const maxLag = Math.floor((targetRate * 60) / minBpm);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = lag; i < smooth.length; i++) {
      corr += smooth[i] * smooth[i - lag];
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

  while (bpm < minBpm) bpm *= 2;
  while (bpm > maxBpm) bpm /= 2;

  return bpm;
}

function beatRegularity(data: Float32Array, sampleRate: number, bpm: number): number {
  const hop = Math.floor(sampleRate / 100);
  const frameCount = Math.floor(data.length / hop);
  const energy = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    const start = i * hop;
    energy[i] = rms(data.subarray(start, start + hop));
  }

  const threshold = rms(energy) * 1.35;
  const peakIntervalSec: number[] = [];
  let lastPeak = -1;

  for (let i = 1; i < energy.length - 1; i++) {
    if (energy[i] <= threshold) continue;
    if (energy[i] < energy[i - 1] || energy[i] < energy[i + 1]) continue;

    const t = i / 100;
    if (lastPeak >= 0) {
      peakIntervalSec.push(t - lastPeak);
    }
    lastPeak = t;
  }

  if (peakIntervalSec.length < 4) return 0.5;

  const expected = 60 / bpm;
  let variance = 0;
  for (const interval of peakIntervalSec) {
    const err = Math.abs(interval - expected) / expected;
    variance += err * err;
  }
  variance /= peakIntervalSec.length;

  return clamp01(1 - variance);
}

function extractFeatures(buffer: AudioBuffer): AudioFeatures {
  const mono = mixToMono(buffer);
  const segment = sliceForAnalysis(mono, buffer.sampleRate);
  const energy = rms(segment);
  const { bassRatio, midRatio, highRatio } = spectralSplit(segment);
  const bpm = estimateBpm(segment, buffer.sampleRate);
  const regularity = beatRegularity(segment, buffer.sampleRate, bpm);

  return {
    bpm,
    energy,
    bassRatio,
    midRatio,
    highRatio,
    beatRegularity: regularity,
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function classifyGenre(features: AudioFeatures): { genre: SongGenre; confidence: number } {
  const scores: Record<SongGenre, number> = {
    "hip-hop": 0,
    jazz: 0,
    belly: 0,
    pop: 0,
  };

  const { bpm, energy, bassRatio, midRatio, highRatio, beatRegularity } = features;

  if (bpm >= 76 && bpm <= 118) scores["hip-hop"] += 2.2;
  if (bassRatio > 0.36) scores["hip-hop"] += 2.4;
  if (energy > 0.07) scores["hip-hop"] += 1;
  if (beatRegularity > 0.55) scores["hip-hop"] += 0.8;

  if (bpm >= 98 && bpm <= 168) scores.jazz += 1.6;
  if (bassRatio >= 0.2 && bassRatio <= 0.34) scores.jazz += 2;
  if (highRatio > 0.28) scores.jazz += 1.2;
  if (beatRegularity < 0.62) scores.jazz += 1.1;

  if (bpm >= 82 && bpm <= 128) scores.belly += 1.4;
  if (midRatio > 0.38) scores.belly += 2.2;
  if (bassRatio >= 0.26 && bassRatio <= 0.4) scores.belly += 1;

  if (bpm >= 108 && bpm <= 148) scores.pop += 2.2;
  if (energy > 0.09) scores.pop += 1.6;
  if (highRatio > 0.22 && bassRatio < 0.4) scores.pop += 1;

  const ranked = (Object.entries(scores) as [SongGenre, number][]).sort((a, b) => b[1] - a[1]);
  const [genre, top] = ranked[0]!;
  const second = ranked[1]?.[1] ?? 0;
  const confidence = clamp01((top - second + 1) / 4);

  return { genre, confidence };
}

/** Analyze the music stem and pick a matching dance playlist. */
export async function analyzeMusicGenre(source: File | Blob): Promise<GenreAnalysis> {
  const buffer = await decodeAudio(source);
  const features = extractFeatures(buffer);
  const { genre, confidence } = classifyGenre(features);

  return {
    genre,
    label: GENRE_LABELS[genre],
    confidence,
    bpm: Math.round(features.bpm),
    energy: features.energy,
    danceUrls: danceUrlsForGenre(genre),
  };
}
