import { defineConfig } from "vite";
import { lunaServerPlugin } from "./vite-plugin-luna-tts";

export default defineConfig({
  plugins: [lunaServerPlugin()],
  server: {
    port: 5173,
    open: true,
  },
});
