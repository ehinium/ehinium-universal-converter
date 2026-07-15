import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isContentBuild = process.env.BUILD_TARGET === "content";
const diagnosticsEnabled = process.env.EUC_DIAGNOSTICS === "true";

export default defineConfig({
  plugins: [react()],
  define: {
    __EUC_DIAGNOSTICS__: JSON.stringify(diagnosticsEnabled),
  },
  build: isContentBuild
    ? {
      emptyOutDir: false,
      lib: {
        entry: "src/content/index.ts",
        formats: ["iife"],
        name: "EhiniumUniversalConverterContent",
        fileName: () => "assets/content.js",
      },
    }
    : {
      rollupOptions: {
        input: {
          popup: "index.html",
          options: "settings.html",
          background: "src/background/index.ts",
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name].[ext]",
        },
      },
    },
});
