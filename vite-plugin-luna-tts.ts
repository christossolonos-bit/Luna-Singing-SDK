import type { Plugin } from "vite";
import { handleExpressionsRequest } from "./server/expressions-handler";
import { handleStemSplitRequest, initStemCache } from "./server/stem-split-handler";
import { handleTtsRequest } from "./server/tts-handler";

type Middleware = Parameters<
  Parameters<NonNullable<Plugin["configureServer"]>>[0]["middlewares"]["use"]
>[2] extends infer N
  ? Parameters<Parameters<NonNullable<Plugin["configureServer"]>>[0]["middlewares"]["use"]>[0]
  : never;

type Req = Parameters<NonNullable<Middleware>>[0];
type Res = Parameters<NonNullable<Middleware>>[1];
type Next = Parameters<NonNullable<Middleware>>[2];

export function lunaServerPlugin(): Plugin {
  const middleware = (req: Req, res: Res, next: Next) => {
    void handleExpressionsRequest(req, res).then((handledExpr) => {
      if (handledExpr) return;
      void handleStemSplitRequest(req, res).then((handled) => {
        if (handled) return;
        void handleTtsRequest(req, res).then((handledTts) => {
          if (!handledTts) next();
        });
      });
    });
  };

  return {
    name: "luna-server",
    configureServer(server) {
      void initStemCache();
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      void initStemCache();
      server.middlewares.use(middleware);
    },
  };
}

/** @deprecated Use lunaServerPlugin */
export function lunaTtsPlugin(): Plugin {
  return lunaServerPlugin();
}
