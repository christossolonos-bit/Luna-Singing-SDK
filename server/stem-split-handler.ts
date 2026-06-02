import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CACHE_ROOT = join(PROJECT_ROOT, ".cache", "luna-stems");
const PYTHON_SCRIPT = join(PROJECT_ROOT, "server", "split_stems.py");
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const JOB_ID_RE = /^[0-9a-f-]{36}$/i;

type SplitJob = {
  vocalsPath: string;
  instrumentalPath: string;
};

const jobs = new Map<string, SplitJob>();

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function readBodyBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

function execCheck(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      resolvePromise({ ok: code === 0, stdout, stderr });
    });
    proc.on("error", () => {
      resolvePromise({ ok: false, stdout, stderr });
    });
  });
}

type PythonRunner = {
  cmd: string;
  argsPrefix: string[];
};

async function findPythonWithDemucs(): Promise<PythonRunner> {
  const candidates: PythonRunner[] =
    process.platform === "win32"
      ? [
          { cmd: "py", argsPrefix: ["-3"] },
          { cmd: "python", argsPrefix: [] },
          { cmd: "python3", argsPrefix: [] },
        ]
      : [
          { cmd: "python3", argsPrefix: [] },
          { cmd: "python", argsPrefix: [] },
        ];

  for (const candidate of candidates) {
    const check = await execCheck(candidate.cmd, [
      ...candidate.argsPrefix,
      "-c",
      "import demucs; print('ok')",
    ]);
    if (check.ok && check.stdout.includes("ok")) {
      return candidate;
    }
  }

  throw new Error(
    "Demucs not found. Install with: pip install -r requirements-server.txt (or: pip install demucs)",
  );
}

async function discoverStemOutputs(
  workDir: string,
): Promise<{ vocals: string; instrumental: string }> {
  const manifestPath = join(workDir, "manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { vocals?: string; instrumental?: string };
    if (manifest.vocals && manifest.instrumental) {
      await stat(manifest.vocals);
      await stat(manifest.instrumental);
      return { vocals: manifest.vocals, instrumental: manifest.instrumental };
    }
  } catch {
    // Fall back to scanning Demucs output folders.
  }

  const htdemucsRoot = join(workDir, "separated", "htdemucs");
  const entries = await readdir(htdemucsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const vocals = join(htdemucsRoot, entry.name, "vocals.wav");
    const instrumental = join(htdemucsRoot, entry.name, "no_vocals.wav");
    try {
      await stat(vocals);
      await stat(instrumental);
      return { vocals, instrumental };
    } catch {
      // Try next Demucs output folder.
    }
  }

  throw new Error("Demucs finished but separated stem files were not found");
}

function spawnPythonSplit(
  runner: PythonRunner,
  inputPath: string,
  workDir: string,
): Promise<{ vocals: string; instrumental: string }> {
  const args = [...runner.argsPrefix, PYTHON_SCRIPT, inputPath, workDir];

  return new Promise((resolvePromise, reject) => {
    const proc = spawn(runner.cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";

    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Demucs exited with code ${code}`));
        return;
      }

      void discoverStemOutputs(workDir).then(resolvePromise).catch((err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  });
}

function safeFilename(name: string): string {
  const base = name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120);
  return base || "song";
}

export async function handleStemSplitRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";

  if (url === "/api/stems/check" && req.method === "GET") {
    try {
      const runner = await findPythonWithDemucs();
      sendJson(res, 200, { ready: true, python: `${runner.cmd} ${runner.argsPrefix.join(" ")}`.trim() });
    } catch (err) {
      sendJson(res, 200, {
        ready: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const cacheMatch = url.match(/^\/api\/stems\/cache\/([^/]+)\/(vocals|instrumental)\.wav$/);
  if (cacheMatch && req.method === "GET") {
    const jobId = cacheMatch[1]!;
    const kind = cacheMatch[2]!;

    if (!JOB_ID_RE.test(jobId)) {
      sendJson(res, 400, { error: "Invalid job id" });
      return true;
    }

    const job = jobs.get(jobId);
    if (!job) {
      sendJson(res, 404, { error: "Stem cache expired or not found" });
      return true;
    }

    const filePath = kind === "vocals" ? job.vocalsPath : job.instrumentalPath;

    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/wav");
    createReadStream(filePath).pipe(res);
    return true;
  }

  if (url === "/api/stems/split" && req.method === "POST") {
    const jobId = randomUUID();
    const workDir = join(CACHE_ROOT, jobId);
    const filename = safeFilename(req.headers["x-filename"]?.toString() ?? "song.mp3");

    try {
      await mkdir(workDir, { recursive: true });

      const body = await readBodyBuffer(req, MAX_UPLOAD_BYTES);
      if (body.length === 0) {
        sendJson(res, 400, { error: "Empty upload" });
        return true;
      }

      const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : ".wav";
      const inputPath = join(workDir, `input${ext}`);
      await writeFile(inputPath, body);

      const python = await findPythonWithDemucs();
      const outputs = await spawnPythonSplit(python, inputPath, workDir);

      const vocalsPath = join(workDir, "vocals.wav");
      const instrumentalPath = join(workDir, "instrumental.wav");
      await copyFile(outputs.vocals, vocalsPath);
      await copyFile(outputs.instrumental, instrumentalPath);

      jobs.set(jobId, { vocalsPath, instrumentalPath });

      sendJson(res, 200, {
        jobId,
        vocalsUrl: `/api/stems/cache/${jobId}/vocals.wav`,
        instrumentalUrl: `/api/stems/cache/${jobId}/instrumental.wav`,
        originalName: filename,
      });
    } catch (err) {
      console.error("[luna-stems]", err);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : "Stem split failed",
      });
    }

    return true;
  }

  return false;
}

/** Optional: preload cache dir at startup. */
export async function initStemCache(): Promise<void> {
  await mkdir(CACHE_ROOT, { recursive: true });
}
