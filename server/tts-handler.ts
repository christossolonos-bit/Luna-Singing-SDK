import type { IncomingMessage, ServerResponse } from "node:http";
import { EdgeTTS } from "edge-tts-universal";
import { LUNA_LANGUAGE_OPTIONS, resolveLunaVoice } from "../src/voice/lunaVoiceConfig";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export async function handleTtsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";

  if (url === "/api/tts/voices" && req.method === "GET") {
    sendJson(res, 200, {
      defaultVoice: resolveLunaVoice("auto"),
      languages: LUNA_LANGUAGE_OPTIONS,
    });
    return true;
  }

  if (url === "/api/tts/speak" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        text?: string;
        lang?: string;
      };

      const text = body.text?.trim();
      if (!text) {
        sendJson(res, 400, { error: "Missing text" });
        return true;
      }

      const voice = resolveLunaVoice(body.lang ?? "auto");
      const tts = new EdgeTTS(text, voice);
      const result = await tts.synthesize();
      const buffer = Buffer.from(await result.audio.arrayBuffer());

      res.statusCode = 200;
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Luna-Voice", voice);
      res.end(buffer);
    } catch (err) {
      console.error("[luna-tts]", err);
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : "TTS synthesis failed",
      });
    }
    return true;
  }

  return false;
}
