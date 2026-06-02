import { ALL_DANCE_URLS, IDLE_ANIMATION_URL } from "../animation/danceAnimations";

export type MotionCatalog = {
  idleUrl: string;
  playlistUrls: readonly string[];
  label: string;
  /** Wait for each clip to finish instead of transitioning on motion stillness. */
  playFullClips?: boolean;
  /** Loop this clip while stems are playing (Viktor singing pose). */
  singUrl?: string;
};

const AICHRIS_VRM_RE = /^aichris\.vrm$/i;

export function isAichrisVrm(filename: string): boolean {
  return AICHRIS_VRM_RE.test(filename.trim());
}

export function defaultMotionCatalog(): MotionCatalog {
  return {
    idleUrl: IDLE_ANIMATION_URL,
    playlistUrls: ALL_DANCE_URLS,
    label: "dance catalog",
  };
}

export async function motionCatalogForVrm(filename: string): Promise<MotionCatalog> {
  if (!isAichrisVrm(filename)) {
    return defaultMotionCatalog();
  }

  const res = await fetch("/api/viktor-expressions/list");
  if (!res.ok) {
    throw new Error(`Viktor expressions unavailable (${res.status})`);
  }

  const payload = (await res.json()) as {
    clips?: string[];
    idle?: string | null;
    sing?: string | null;
    dir?: string;
  };

  const clips = payload.clips?.filter(Boolean) ?? [];
  if (clips.length === 0) {
    throw new Error(
      `No VRMA clips found in Viktor expressions folder${payload.dir ? `: ${payload.dir}` : ""}`,
    );
  }

  const idleUrl = payload.idle ?? clips[0]!;

  return {
    idleUrl,
    playlistUrls: clips,
    label: "Viktor expressions",
    playFullClips: true,
    singUrl: payload.sing ?? undefined,
  };
}
