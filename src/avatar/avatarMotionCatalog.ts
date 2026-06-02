import { ALL_DANCE_URLS, IDLE_ANIMATION_URL } from "../animation/danceAnimations";

export type MotionCatalog = {
  idleUrl: string;
  playlistUrls: readonly string[];
  label: string;
  /** Wait for each clip to finish instead of transitioning on motion stillness. */
  playFullClips?: boolean;
  /** Beat-synced sway, arms, and shout reactions on top of idle pose. */
  proceduralPerformance?: boolean;
};

const AICHRIS_VRM_RE = /^aichris\.vrm$/i;
const FEMALE_VRM_RE = /^(luna|shrine maiden|himari|shrine)( \(\d+\))?\.vrm$/i;

export function isAichrisVrm(filename: string): boolean {
  return AICHRIS_VRM_RE.test(filename.trim());
}

export function isFemaleAvatar(filename: string): boolean {
  const name = filename.trim().toLowerCase();
  if (isAichrisVrm(filename)) return false;
  return FEMALE_VRM_RE.test(name) || name.includes("maiden");
}

export function defaultMotionCatalog(): MotionCatalog {
  return {
    idleUrl: IDLE_ANIMATION_URL,
    playlistUrls: ALL_DANCE_URLS,
    label: "dance catalog",
  };
}

type ExpressionListPayload = {
  clips?: string[];
  idle?: string | null;
  dir?: string;
};

async function catalogFromApi(
  apiPath: string,
  label: string,
): Promise<MotionCatalog> {
  const res = await fetch(apiPath);
  if (!res.ok) {
    throw new Error(`${label} expressions unavailable (${res.status})`);
  }

  const payload = (await res.json()) as ExpressionListPayload;
  const clips = payload.clips?.filter(Boolean) ?? [];
  if (clips.length === 0) {
    throw new Error(
      `No VRMA clips found in ${label} expressions folder${payload.dir ? `: ${payload.dir}` : ""}`,
    );
  }

  const idleUrl = payload.idle ?? clips[0]!;

  return {
    idleUrl,
    playlistUrls: clips,
    label: `${label} · procedural`,
    playFullClips: true,
    proceduralPerformance: true,
  };
}

export async function motionCatalogForVrm(filename: string): Promise<MotionCatalog> {
  if (isAichrisVrm(filename)) {
    return catalogFromApi("/api/viktor-expressions/list", "Viktor");
  }

  if (isFemaleAvatar(filename)) {
    try {
      return await catalogFromApi("/api/female-expressions/list", "Female");
    } catch (err) {
      console.warn("Female expressions unavailable, using defaults with performance:", err);
      return {
        idleUrl: IDLE_ANIMATION_URL,
        playlistUrls: ALL_DANCE_URLS,
        label: "dance catalog + performance",
        proceduralPerformance: true,
      };
    }
  }

  return defaultMotionCatalog();
}
