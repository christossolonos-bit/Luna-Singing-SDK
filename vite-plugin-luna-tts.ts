import type { Plugin } from "vite";
import { handleTtsRequest } from "./server/tts-handler";

export function lunaTtsPlugin(): Plugin {
  const middleware = (
    req: Parameters<Parameters<NonNullable<Plugin["configureServer"]>>[0]["middlewares"]["use"]>[0],
    res: Parameters<Parameters<NonNullable<Plugin["configureServer"]>>[0]["middlewares"]["use"]>[1],
    next: Parameters<Parameters<NonNullable<Plugin["configureServer"]>>[0]["middlewares"]["use"]>[2],
  ) => {
    void handleTtsRequest(req, res).then((handled) => {
      if (!handled) next();
    });
  };

  return {
    name: "luna-tts",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
