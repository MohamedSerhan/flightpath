import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: "src/web",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "^/api/": "http://localhost:3001",
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
