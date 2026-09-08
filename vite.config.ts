import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
export default defineConfig({
  plugins: [solid()],
  server: { proxy: { "/api": "http://localhost:3100" } },
  build: { target: "esnext" },
});
