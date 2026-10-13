import { defineConfig } from "vite";
import { staticPwa } from "./pwa.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), staticPwa()],
  server: {
    proxy: { "/api": process.env.API_PROXY_TARGET || "http://127.0.0.1:8000" },
  },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.js" },
});
