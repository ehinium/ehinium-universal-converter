import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const isContentBuild = process.env.BUILD_TARGET === "content";
const diagnosticsEnabled = process.env.EUC_DIAGNOSTICS === "true";
const performanceDiagnosticsEnabled =
  process.env.EUC_PERFORMANCE_DIAGNOSTICS === "true";
const outputDirectory = performanceDiagnosticsEnabled ? "dist-perf" : "dist";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  define: {
    __EUC_DIAGNOSTICS__: JSON.stringify(diagnosticsEnabled),
    __EUC_PERF_DIAGNOSTICS__: JSON.stringify(performanceDiagnosticsEnabled),
  },
  build: isContentBuild
    ? {
      outDir: outputDirectory,
      emptyOutDir: false,
      lib: {
        entry: "src/content/index.ts",
        formats: ["iife"],
        name: "EhiniumUniversalConverterContent",
        fileName: () => "assets/content.js",
      },
    }
    : {
      outDir: outputDirectory,
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
