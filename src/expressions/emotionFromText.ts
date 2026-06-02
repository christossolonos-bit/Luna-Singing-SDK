import type { EmotionName, EmotionWeights } from "./types";

const KEYWORDS: Record<EmotionName, string[]> = {
  happy: [
    "love", "loving", "joy", "happy", "happiness", "smile", "smiling", "dream", "dreaming",
    "shine", "shining", "heart", "beautiful", "together", "celebrate", "dance", "dancing",
    "light", "hope", "free", "fun", "yeah", "yes", "wonderful", "paradise", "heaven",
    "kiss", "sweet", "dear", "baby", "forever", "alive", "fly", "flying", "star",
    "愛", "幸", "楽", "笑", "光", "夢", "好き", "嬉", "恋",
  ],
  sad: [
    "sad", "sadness", "cry", "crying", "tears", "tear", "lonely", "loneliness", "goodbye",
    "miss", "missing", "hurt", "hurting", "pain", "painful", "lost", "alone", "farewell",
    "broken", "rain", "sorry", "regret", "grief", "mourn", "empty", "fade", "cold",
    "leave", "left", "gone", "end", "never", "without", "ache", "blue",
    "悲", "涙", "寂", "別", "哀", "辛", "孤独",
  ],
  angry: [
    "angry", "anger", "rage", "hate", "hatred", "fight", "fighting", "burn", "burning",
    "mad", "fury", "furious", "scream", "screaming", "shout", "war", "enemy", "revenge",
    "kill", "destroy", "break", "violent", "wrath",
    "怒", "憎", "戦", "叫", "恨",
  ],
  relaxed: [
    "calm", "peace", "peaceful", "quiet", "soft", "softly", "gentle", "gently", "rest",
    "resting", "slow", "slowly", "breathe", "breathing", "easy", "chill", "flow", "floating",
    "mellow", "tender", "warm", "hold", "close",
    "静", "優", "安", "穏", "柔",
  ],
  surprised: [
    "wow", "oh", "what", "sudden", "suddenly", "shock", "shocked", "amazing", "unexpected",
    "gasp", "really", "wait", "whoa", "no way", "can't believe",
    "驚", "え", "あ", "本当",
  ],
  frustrated: [
    "frustrated", "frustration", "annoyed", "annoying", "ugh", "why", "tired", "enough",
    "stuck", "can't", "won't", "again", "stress", "stressed", "irritated", "bothered",
    "困", "疲", "もう", "イライラ",
  ],
  confused: [
    "confused", "confusion", "puzzled", "wonder", "wondering", "huh", "strange", "weird",
    "don't know", "dont know", "question", "迷", "不思議",
  ],
  neutral: ["okay", "fine", "alright", "maybe"],
  fear: ["afraid", "fear", "scared", "terror", "horror", "nightmare", "panic", "恐", "怖"],
  disgusted: ["disgust", "disgusted", "gross", "nasty", "ugh", "ew", "sick", "嫌"],
};

/** Multi-label scores — several emotions can be active at once. */
export function emotionFromText(text: string): EmotionWeights {
  const lower = text.toLowerCase();
  const scores: EmotionWeights = {
    happy: 0,
    sad: 0,
    angry: 0,
    relaxed: 0,
    surprised: 0,
    frustrated: 0,
    confused: 0,
    neutral: 0,
    fear: 0,
    disgusted: 0,
  };

  for (const [emotion, words] of Object.entries(KEYWORDS) as [EmotionName, string[]][]) {
    for (const word of words) {
      if (lower.includes(word.toLowerCase())) {
        scores[emotion] += 1;
      }
    }
  }

  // Frustrated maps to angry + sad on the face as well
  if (scores.frustrated > 0) {
    scores.angry += scores.frustrated * 0.7;
    scores.sad += scores.frustrated * 0.45;
  }

  const peak = Math.max(...Object.values(scores));
  if (peak === 0) return scores;

  for (const emotion of Object.keys(scores) as EmotionName[]) {
    scores[emotion] = Math.min(1, scores[emotion] / peak);
  }

  return scores;
}

/** Current lyric line from a timed cue list, if any. */
export function activeLyricAtTime(
  cues: { start: number; end: number; text?: string }[],
  time: number,
): string | null {
  const cue = cues.find((c) => time >= c.start && time < c.end);
  return cue?.text?.trim() ?? null;
}
