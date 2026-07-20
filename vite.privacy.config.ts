import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/ehinium-universal-converter/",
  publicDir: "public",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "docs",
    emptyOutDir: false,
    rollupOptions: {
      input: "privacy.html",
      output: {
        entryFileNames: "assets/privacy.js",
        chunkFileNames: "assets/privacy-[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
