import { defineConfig } from "vite";
import { lunaTtsPlugin } from "./vite-plugin-luna-tts";

export default defineConfig({
  plugins: [lunaTtsPlugin()],
  server: {
    port: 5173,
    open: true,
  },
});
