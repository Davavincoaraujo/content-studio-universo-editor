import { defineConfig, loadEnv } from "vite";
import { localAssetUpload } from "./server/upload";
import { readFileSync } from "node:fs";

export default defineConfig(({ command }) => ({
  plugins: [localAssetUpload(loadEnv("development", process.cwd(), "EXTENSION_"))],
  root: "web-src",
  server: {
    host: "localhost",
    port: 9082,
    strictPort: true,
    https: command === "serve" ? {
      key: readFileSync(new URL("./.local-cert/localhost-key.pem", import.meta.url)),
      cert: readFileSync(new URL("./.local-cert/localhost.pem", import.meta.url)),
    } : undefined,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
}));
