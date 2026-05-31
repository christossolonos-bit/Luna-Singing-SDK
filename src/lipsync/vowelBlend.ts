import { VISEMES, type Lipsync } from "wawa-lipsync";

/** VRM vowel shapes: A · E · I · O · U */
export type VowelWeights = {
  aa: number;
  ee: number;
  ih: number;
  oh: number;
  ou: number;
};

export const VOWEL_KEYS = ["aa", "ee", "ih", "oh", "ou"] as const;

export const EMPTY_VOWELS: VowelWeights = {
  aa: 0,
  ee: 0,
  ih: 0,
  oh: 0,
  ou: 0,
};

const VISEME_VOWEL: Partial<Record<VISEMES, keyof VowelWeights>> = {
  [VISEMES.aa]: "aa",
  [VISEMES.E]: "ee",
  [VISEMES.I]: "ih",
  [VISEMES.O]: "oh",
  [VISEMES.U]: "ou",
};

const PLOSIVE_VISEMES = new Set<VISEMES>([
  VISEMES.PP,
  VISEMES.DD,
  VISEMES.kk,
  VISEMES.nn,
]);

const FRICATIVE_VISEMES = new Set<VISEMES>([
  VISEMES.FF,
  VISEMES.SS,
  VISEMES.TH,
  VISEMES.CH,
  VISEMES.RR,
]);

/** Tight consonant hints — keeps mouth smaller between vowels. */
const CONSONANT_VOWEL_HINT: Partial<Record<VISEMES, Partial<VowelWeights>>> = {
  [VISEMES.PP]: { ih: 0.12 },
  [VISEMES.FF]: { ee: 0.18, ih: 0.1 },
  [VISEMES.TH]: { ih: 0.15 },
  [VISEMES.DD]: { ee: 0.1 },
  [VISEMES.kk]: { ih: 0.12 },
  [VISEMES.CH]: { ih: 0.14 },
  [VISEMES.SS]: { ih: 0.2, ee: 0.1 },
  [VISEMES.nn]: { ih: 0.08 },
  [VISEMES.RR]: { oh: 0.12 },
};

type WawaFeatures = {
  volume: number;
  centroid: number;
  bands: number[];
};

type LipsyncInternal = {
  features: WawaFeatures | null;
  history: WawaFeatures[];
  viseme: VISEMES;
  getAveragedFeatures: () => WawaFeatures;
  computeVisemeScores: (
    current: WawaFeatures,
    avg: WawaFeatures,
    dVolume: number,
    dCentroid: number,
  ) => Record<VISEMES, number>;
  adjustScoresForConsistency: (scores: Record<VISEMES, number>) => Record<VISEMES, number>;
};

function getLipsyncInternal(lipsync: Lipsync): LipsyncInternal {
  return lipsync as unknown as LipsyncInternal;
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function addVowel(target: VowelWeights, key: keyof VowelWeights, amount: number): void {
  target[key] = clamp(target[key] + amount);
}

/** Pick one dominant vowel per frame so shapes don't stack into a round O. */
function sharpenExclusive(weights: VowelWeights, temperature = 0.28): VowelWeights {
  const exps = VOWEL_KEYS.map((k) => Math.exp(weights[k] / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (sum <= 1e-6) return { ...EMPTY_VOWELS };

  const out = { ...EMPTY_VOWELS };
  let peakKey: (typeof VOWEL_KEYS)[number] = "aa";
  let peakVal = 0;

  VOWEL_KEYS.forEach((key, i) => {
    const v = exps[i] / sum;
    out[key] = v;
    if (v > peakVal) {
      peakVal = v;
      peakKey = key;
    }
  });

  for (const key of VOWEL_KEYS) {
    if (key !== peakKey) {
      out[key] *= 0.12;
    }
  }

  return out;
}

/** Direct shape from wawa's winning viseme — discrete phoneme, not a vowel soup. */
function visemeDirectWeight(viseme: VISEMES, strength: number): VowelWeights {
  const out = { ...EMPTY_VOWELS };
  const vowelKey = VISEME_VOWEL[viseme];
  if (vowelKey) {
    out[vowelKey] = strength;
    return out;
  }

  const hint = CONSONANT_VOWEL_HINT[viseme];
  if (hint) {
    for (const [k, v] of Object.entries(hint) as [keyof VowelWeights, number][]) {
      out[k] = v * strength;
    }
  }

  return out;
}

function blendVowels(a: VowelWeights, b: VowelWeights, t: number): VowelWeights {
  const u = clamp(t);
  return {
    aa: a.aa * (1 - u) + b.aa * u,
    ee: a.ee * (1 - u) + b.ee * u,
    ih: a.ih * (1 - u) + b.ih * u,
    oh: a.oh * (1 - u) + b.oh * u,
    ou: a.ou * (1 - u) + b.ou * u,
  };
}

function spectralVowelHint(features: WawaFeatures, volume: number): VowelWeights {
  const hint = { ...EMPTY_VOWELS };
  const [, midLow, mid, midHigh, high] = features.bands;
  const c = features.centroid;
  const v = volume * 0.35;

  addVowel(hint, "aa", clamp(mid * 0.75) * v);
  addVowel(hint, "ee", clamp(midHigh * 0.9 + high * 0.55) * v);
  addVowel(hint, "ih", clamp(high * 0.95 + midHigh * 0.4) * v);
  addVowel(hint, "oh", clamp(midLow * 0.35) * v);
  addVowel(hint, "ou", clamp(midLow * 0.22) * v);

  if (c > 2100) addVowel(hint, "ih", 0.18 * v);
  if (c > 1550 && c < 2300) addVowel(hint, "ee", 0.15 * v);
  if (c < 1350) addVowel(hint, "ou", 0.12 * v);

  return hint;
}

function scoresToVowels(scores: Record<VISEMES, number>, volumeScale: number): VowelWeights {
  const out = { ...EMPTY_VOWELS };

  for (const [viseme, score] of Object.entries(scores) as [VISEMES, number][]) {
    if (score <= 0.05) continue;

    const weighted = score * volumeScale;
    const vowelKey = VISEME_VOWEL[viseme];
    if (vowelKey) {
      addVowel(out, vowelKey, weighted);
      continue;
    }

    const hint = CONSONANT_VOWEL_HINT[viseme];
    if (hint) {
      for (const [k, v] of Object.entries(hint) as [keyof VowelWeights, number][]) {
        addVowel(out, k, v * weighted);
      }
    }
  }

  return out;
}

function boostPrimaryViseme(
  weights: VowelWeights,
  viseme: VISEMES,
  amount: number,
): VowelWeights {
  const key = VISEME_VOWEL[viseme];
  if (!key) return weights;
  return { ...weights, [key]: clamp(weights[key] + amount) };
}

function plosiveClosure(scores: Record<VISEMES, number>): number {
  let p = 0;
  for (const v of PLOSIVE_VISEMES) {
    p = Math.max(p, scores[v] ?? 0);
  }
  return clamp(p);
}

function fricativeTightness(scores: Record<VISEMES, number>): number {
  let f = 0;
  for (const v of FRICATIVE_VISEMES) {
    f = Math.max(f, scores[v] ?? 0);
  }
  return clamp(f);
}

/** Build word-focused A/E/I/O/U weights — one dominant shape per syllable. */
export function computeVowelWeights(
  lipsync: Lipsync,
  vocalLevel: number,
): VowelWeights {
  if (vocalLevel < 0.04) return { ...EMPTY_VOWELS };

  const internal = getLipsyncInternal(lipsync);
  const current = internal.features;
  if (!current || internal.history.length < 2) return { ...EMPTY_VOWELS };

  const avg = internal.getAveragedFeatures();
  const dVolume = current.volume - avg.volume;
  const dCentroid = current.centroid - avg.centroid;

  let scores = internal.computeVisemeScores(current, avg, dVolume, dCentroid);
  scores = internal.adjustScoresForConsistency(scores);

  const silScore = scores[VISEMES.sil] ?? 0;
  const wordGap =
    silScore > 0.35 ||
    current.volume < avg.volume * 0.62 ||
    vocalLevel < 0.055;

  if (wordGap) {
    return { ...EMPTY_VOWELS };
  }

  const volumeScale = clamp(vocalLevel * 2.8, 0.25, 1);
  const scoreWeights = scoresToVowels(scores, volumeScale);

  const primaryViseme = internal.viseme;
  const primaryScore = scores[primaryViseme] ?? 0;
  const directStrength = clamp(0.55 + primaryScore * 0.45) * volumeScale;
  const direct = visemeDirectWeight(primaryViseme, directStrength);

  let weights = blendVowels(scoreWeights, direct, 0.72);
  weights = boostPrimaryViseme(weights, primaryViseme, 0.35);

  const spectrum = spectralVowelHint(current, volumeScale * 0.65);
  weights = {
    aa: weights.aa * 0.92 + spectrum.aa * 0.08,
    ee: weights.ee * 0.92 + spectrum.ee * 0.08,
    ih: weights.ih * 0.92 + spectrum.ih * 0.08,
    oh: weights.oh * 0.92 + spectrum.oh * 0.08,
    ou: weights.ou * 0.92 + spectrum.ou * 0.08,
  };

  weights = sharpenExclusive(weights);

  const plosive = plosiveClosure(scores);
  const fricative = fricativeTightness(scores);
  const closure = clamp(plosive * 0.85 + fricative * 0.35);
  const openness = clamp(1 - closure * 0.75);

  return {
    aa: weights.aa * openness,
    ee: weights.ee * openness,
    ih: weights.ih * openness,
    oh: weights.oh * openness,
    ou: weights.ou * openness,
  };
}

export const VOWEL_TO_VRM = {
  aa: "aa",
  ee: "ee",
  ih: "ih",
  oh: "oh",
  ou: "ou",
} as const satisfies Record<keyof VowelWeights, string>;

/** Jaw opening from vowel weights — wide vowels only, not stacked max(). */
export function jawOpennessFromVowels(vw: VowelWeights): number {
  return clamp(vw.aa * 0.75 + vw.oh * 0.45 + vw.ou * 0.25 + vw.ee * 0.15 + vw.ih * 0.08);
}
