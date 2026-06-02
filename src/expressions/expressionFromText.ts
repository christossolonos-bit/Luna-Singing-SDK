const VISEME_EXPRESSIONS = new Set(["aa", "ee", "ih", "oh", "ou"]);

/** Keywords grouped by expression tag (matched to VRM expression names). */
const TAG_KEYWORDS: Record<string, string[]> = {
  happy: [
    "love", "loving", "joy", "happy", "happiness", "smile", "smiling", "dream", "dreaming",
    "shine", "heart", "beautiful", "together", "celebrate", "dance", "hope", "free", "fun",
    "yeah", "yes", "wonderful", "paradise", "heaven", "kiss", "sweet", "dear", "baby",
    "forever", "alive", "fly", "star", "愛", "幸", "楽", "笑", "光", "夢", "好き", "嬉", "恋",
  ],
  sad: [
    "sad", "sadness", "cry", "crying", "tears", "lonely", "goodbye", "miss", "hurt", "pain",
    "lost", "alone", "farewell", "broken", "rain", "sorry", "regret", "grief", "empty", "gone",
    "never", "without", "ache", "blue", "悲", "涙", "寂", "別", "哀", "辛", "孤独",
  ],
  angry: [
    "angry", "anger", "rage", "hate", "fight", "burn", "mad", "fury", "scream", "shout", "war",
    "revenge", "destroy", "break", "violent", "wrath", "怒", "憎", "戦", "叫", "恨",
  ],
  relaxed: [
    "calm", "peace", "peaceful", "quiet", "soft", "gentle", "rest", "slow", "breathe", "easy",
    "chill", "flow", "mellow", "tender", "warm", "hold", "close", "静", "優", "安", "穏", "柔",
  ],
  surprised: [
    "wow", "oh", "what", "sudden", "shock", "shocked", "amazing", "unexpected", "gasp", "really",
    "wait", "whoa", "驚", "え", "あ", "本当",
  ],
  confused: [
    "confused", "confusion", "puzzled", "puzzle", "lost", "wonder", "wondering", "why", "how",
    "huh", "strange", "weird", "unclear", "don't know", "dont know", "misunderstand", "question",
    "迷", "困", "不思議", "なぜ", "どう",
  ],
  neutral: ["okay", "fine", "alright", "maybe", "just", "well"],
  fear: [
    "afraid", "fear", "scared", "terror", "horror", "nightmare", "dark", "hide", "run", "panic",
    "恐", "怖", "暗",
  ],
  disgusted: [
    "disgust", "disgusted", "gross", "nasty", "ugh", "ew", "sick", "vile", "嫌", "吐",
  ],
};

const TAG_ALIASES: Record<string, string[]> = {
  happy: ["happy", "joy", "smile"],
  sad: ["sad", "sorrow", "grief"],
  angry: ["angry", "mad", "rage"],
  relaxed: ["relaxed", "calm"],
  surprised: ["surprised", "surprise", "shock"],
  confused: ["confused", "confusion", "puzzled", "question"],
  neutral: ["neutral"],
  fear: ["fear", "afraid", "scared"],
  disgusted: ["disgusted", "disgust"],
  blink: ["blink", "blinkleft", "blinkright"],
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function scoreTags(text: string): Record<string, number> {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [tag, words] of Object.entries(TAG_KEYWORDS)) {
    let score = 0;
    for (const word of words) {
      if (lower.includes(word.toLowerCase())) {
        score += 1;
      }
    }
    if (score > 0) {
      scores[tag] = score;
    }
  }

  const peak = Math.max(...Object.values(scores), 0);
  if (peak === 0) return scores;

  for (const tag of Object.keys(scores)) {
    scores[tag] = clamp01(scores[tag]! / peak);
  }

  return scores;
}

function tagMatchesExpression(tag: string, expressionName: string): boolean {
  const expr = normalizeName(expressionName);
  const tagNorm = normalizeName(tag);

  if (expr === tagNorm || expr.includes(tagNorm) || tagNorm.includes(expr)) {
    return true;
  }

  const aliases = TAG_ALIASES[tag] ?? [tag];
  return aliases.some((alias) => {
    const a = normalizeName(alias);
    return expr === a || expr.includes(a) || a.includes(expr);
  });
}

/** Map lyric text to weights for every expression the VRM model exposes. */
export function expressionWeightsFromText(
  text: string,
  availableExpressions: readonly string[],
): Record<string, number> {
  const tagScores = scoreTags(text);
  const weights: Record<string, number> = {};

  for (const name of availableExpressions) {
    let best = 0;
    for (const [tag, score] of Object.entries(tagScores)) {
      if (tagMatchesExpression(tag, name)) {
        best = Math.max(best, score);
      }
    }
    weights[name] = best;
  }

  return weights;
}

export function listEmotionExpressions(vrm: {
  expressionManager?: {
    expressionMap?: Record<string, unknown>;
    presetExpressionMap?: Record<string, unknown>;
    customExpressionMap?: Record<string, unknown>;
  } | null;
}): string[] {
  const manager = vrm.expressionManager;
  if (!manager) return [];

  const names = new Set<string>();
  for (const map of [
    manager.expressionMap,
    manager.presetExpressionMap,
    manager.customExpressionMap,
  ]) {
    if (!map) continue;
    for (const key of Object.keys(map)) {
      if (!VISEME_EXPRESSIONS.has(key.toLowerCase())) {
        names.add(key);
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

export { VISEME_EXPRESSIONS };
