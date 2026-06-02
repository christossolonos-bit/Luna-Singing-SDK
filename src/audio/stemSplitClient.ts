export type StemSplitResult = {
  vocals: Blob;
  instrumental: Blob;
  originalName: string;
};

export type StemSplitCheck = {
  ready: boolean;
  python?: string;
  error?: string;
};

export async function checkStemSplitter(): Promise<StemSplitCheck> {
  const res = await fetch("/api/stems/check");
  if (!res.ok) {
    return { ready: false, error: `Server returned ${res.status}` };
  }
  return (await res.json()) as StemSplitCheck;
}

/**
 * Upload a full mixed song; local Demucs splits vocals + instrumental on the dev server.
 */
export async function splitFullSong(
  file: File,
  onStatus?: (message: string) => void,
): Promise<StemSplitResult> {
  onStatus?.("Checking local Demucs…");
  const check = await checkStemSplitter();
  if (!check.ready) {
    throw new Error(check.error ?? "Local stem splitter is not ready");
  }

  onStatus?.(`Splitting "${file.name}" — may take a few minutes (CPU)…`);

  const res = await fetch("/api/stems/split", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": file.name,
    },
    body: file,
  });

  const payload = (await res.json()) as {
    error?: string;
    vocalsUrl?: string;
    instrumentalUrl?: string;
    originalName?: string;
  };

  if (!res.ok) {
    throw new Error(payload.error ?? `Split failed (${res.status})`);
  }

  if (!payload.vocalsUrl || !payload.instrumentalUrl) {
    throw new Error("Split response missing stem URLs");
  }

  onStatus?.("Downloading separated stems…");

  const [vocalsRes, instrumentalRes] = await Promise.all([
    fetch(payload.vocalsUrl),
    fetch(payload.instrumentalUrl),
  ]);

  if (!vocalsRes.ok || !instrumentalRes.ok) {
    throw new Error("Failed to download separated stems");
  }

  const [vocals, instrumental] = await Promise.all([
    vocalsRes.blob(),
    instrumentalRes.blob(),
  ]);

  onStatus?.("Stems ready");

  return {
    vocals,
    instrumental,
    originalName: payload.originalName ?? file.name,
  };
}

export function stemsAsFiles(
  result: StemSplitResult,
): { music: File; vocals: File } {
  const base = result.originalName.replace(/\.[^.]+$/, "");
  return {
    music: new File([result.instrumental], `${base} (instrumental).wav`, {
      type: "audio/wav",
    }),
    vocals: new File([result.vocals], `${base} (vocals).wav`, {
      type: "audio/wav",
    }),
  };
}
