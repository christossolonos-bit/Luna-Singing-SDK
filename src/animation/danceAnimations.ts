export type SongGenre = "hip-hop" | "jazz" | "belly" | "pop";

export type DanceClip = {
  id: string;
  file: string;
  genres: SongGenre[];
};

/** All dance VRMA clips (served from public/dance/). */
export const DANCE_CATALOG: DanceClip[] = [
  { id: "bellydancing", file: "Bellydancing.vrma", genres: ["belly", "pop"] },
  { id: "hip-hop", file: "Hip Hop Dancing.vrma", genres: ["hip-hop", "pop"] },
  { id: "hip-hop-1", file: "Hip Hop Dancing (1).vrma", genres: ["hip-hop", "pop"] },
  { id: "arms-hip-hop", file: "Arms Hip Hop Dance.vrma", genres: ["hip-hop"] },
  { id: "booty-hip-hop", file: "Booty Hip Hop Dance.vrma", genres: ["hip-hop", "pop"] },
  { id: "breakdance", file: "Breakdance Ready.vrma", genres: ["hip-hop", "pop"] },
  { id: "rumba", file: "Rumba Dancing.vrma", genres: ["jazz", "belly", "pop"] },
  { id: "snake-hip-hop", file: "Snake Hip Hop Dance.vrma", genres: ["hip-hop"] },
];

export const IDLE_ANIMATION_URL = "/standing2.vrma";

/** Seconds to blend into the next dance before the current clip ends. */
export const ANIMATION_CROSSFADE_SEC = 0.25;

/** Bone-driven in-between when motion stops (seconds). */
export const BONE_BRIDGE_SEC = 0.4;

export const GENRE_LABELS: Record<SongGenre, string> = {
  "hip-hop": "Hip Hop",
  jazz: "Jazz",
  belly: "Belly / World",
  pop: "Pop / Electronic",
};

export function danceUrl(clip: DanceClip): string {
  return `/dance/${clip.file}`;
}

export const ALL_DANCE_URLS = DANCE_CATALOG.map(danceUrl);

/** Pick dance clips that match the detected genre (fallback: full catalog). */
export function danceUrlsForGenre(genre: SongGenre): string[] {
  const matched = DANCE_CATALOG.filter((clip) => clip.genres.includes(genre)).map(danceUrl);

  if (matched.length >= 2) {
    return matched;
  }

  return ALL_DANCE_URLS;
}
