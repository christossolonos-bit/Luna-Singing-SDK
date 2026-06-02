import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, resolve } from "node:path";

type ExpressionCatalog = {
  apiPrefix: string;
  dir: string;
  idlePatterns: RegExp[];
};

const CATALOGS: ExpressionCatalog[] = [
  {
    apiPrefix: "/api/viktor-expressions",
    dir: resolve(
      process.env.LUNA_VIKTOR_EXPRESSIONS_DIR ?? "D:\\Luna streamer\\expressions1",
    ),
    idlePatterns: [/man%20standing\.vrma$/i, /standing/i],
  },
  {
    apiPrefix: "/api/female-expressions",
    dir: resolve(
      process.env.LUNA_FEMALE_EXPRESSIONS_DIR ?? "D:\\Luna streamer\\expressions",
    ),
    idlePatterns: [/standing2\.vrma$/i, /standing/i],
  },
];

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function safeVrmaName(name: string): string | null {
  const base = basename(name);
  if (!base.toLowerCase().endsWith(".vrma")) return null;
  if (base.includes("..") || base.includes("/") || base.includes("\\")) return null;
  return base;
}

async function resolveVrmaPath(catalog: ExpressionCatalog, name: string): Promise<string | null> {
  const safe = safeVrmaName(name);
  if (!safe) return null;

  const filePath = resolve(catalog.dir, safe);
  if (!filePath.startsWith(catalog.dir)) return null;

  try {
    const info = await stat(filePath);
    return info.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

async function listClips(catalog: ExpressionCatalog): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(catalog.dir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.toLowerCase().endsWith(".vrma"))
    .filter((name) => {
      const lower = name.toLowerCase();
      return lower !== "thinking.vrma" && lower !== "singing.vrma";
    })
    .sort((a, b) => a.localeCompare(b));
}

function pickIdle(clips: string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const hit = clips.find((clip) => pattern.test(clip));
    if (hit) return hit;
  }
  return clips[0] ?? null;
}

function findCatalog(url: string): ExpressionCatalog | null {
  return CATALOGS.find((catalog) => url.startsWith(catalog.apiPrefix)) ?? null;
}

export async function handleExpressionsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";

  for (const catalog of CATALOGS) {
    if (url === `${catalog.apiPrefix}/list` && req.method === "GET") {
      const files = await listClips(catalog);
      const clips = files.map(
        (file) => `${catalog.apiPrefix}/${encodeURIComponent(file)}`,
      );
      const idle = pickIdle(clips, catalog.idlePatterns);

      sendJson(res, 200, {
        dir: catalog.dir,
        idle,
        clips,
      });
      return true;
    }
  }

  const fileMatch = url.match(/^(\/api\/(?:viktor|female)-expressions)\/([^?]+)$/);
  if (fileMatch && req.method === "GET") {
    const catalog = findCatalog(fileMatch[1]!);
    if (!catalog) return false;

    const filePath = await resolveVrmaPath(catalog, decodeURIComponent(fileMatch[2]!));
    if (!filePath) {
      sendJson(res, 404, { error: "VRMA not found" });
      return true;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}
