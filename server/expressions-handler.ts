import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join, resolve } from "node:path";

const VIKTOR_EXPRESSIONS_DIR = resolve(
  process.env.LUNA_VIKTOR_EXPRESSIONS_DIR ?? "D:\\Luna streamer\\expressions1",
);

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

async function resolveVrmaPath(name: string): Promise<string | null> {
  const safe = safeVrmaName(name);
  if (!safe) return null;

  const filePath = resolve(VIKTOR_EXPRESSIONS_DIR, safe);
  if (!filePath.startsWith(VIKTOR_EXPRESSIONS_DIR)) return null;

  try {
    const info = await stat(filePath);
    return info.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

async function listViktorClips(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(VIKTOR_EXPRESSIONS_DIR);
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

async function viktorSingUrl(): Promise<string | null> {
  const filePath = resolve(VIKTOR_EXPRESSIONS_DIR, "singing.vrma");
  try {
    const info = await stat(filePath);
    return info.isFile()
      ? `/api/viktor-expressions/${encodeURIComponent("singing.vrma")}`
      : null;
  } catch {
    return null;
  }
}

export async function handleExpressionsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";

  if (url === "/api/viktor-expressions/list" && req.method === "GET") {
    const files = await listViktorClips();
    const clips = files.map(
      (file) => `/api/viktor-expressions/${encodeURIComponent(file)}`,
    );
    const idle =
      clips.find((clip) => /man%20standing\.vrma$/i.test(clip)) ??
      clips.find((clip) => /standing/i.test(clip)) ??
      clips[0] ??
      null;
    const sing = await viktorSingUrl();

    sendJson(res, 200, {
      dir: VIKTOR_EXPRESSIONS_DIR,
      idle,
      sing,
      clips,
    });
    return true;
  }

  const fileMatch = url.match(/^\/api\/viktor-expressions\/([^?]+)$/);
  if (fileMatch && req.method === "GET") {
    const filePath = await resolveVrmaPath(decodeURIComponent(fileMatch[1]!));
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
