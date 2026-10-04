import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  root: "client",
  publicDir: "../public",
  plugins: [tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./client", import.meta.url)) },
  },
  build: { outDir: "../dist", emptyOutDir: true, assetsInlineLimit: 0 },
});
