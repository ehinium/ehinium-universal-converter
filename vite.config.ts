import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isContentBuild = process.env.BUILD_TARGET === "content";

export default defineConfig({
  plugins: [react()],
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
          },
          output: {
            entryFileNames: "assets/[name].js",
            chunkFileNames: "assets/[name].js",
            assetFileNames: "assets/[name].[ext]",
          },
        },
      },
});