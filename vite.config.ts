import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const iranianRatesApiUrl =
  "https://ehinium-rates-api.ehinium.workers.dev/v1/rates";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isContentBuild =
    (env.BUILD_TARGET ?? process.env.BUILD_TARGET) === "content";
  const diagnosticsEnabled =
    (env.EUC_DIAGNOSTICS ?? process.env.EUC_DIAGNOSTICS) === "true";
  const performanceDiagnosticsEnabled =
    (env.EUC_PERFORMANCE_DIAGNOSTICS ??
      process.env.EUC_PERFORMANCE_DIAGNOSTICS) === "true";
  // A token compiled into a browser extension is extractable and is not a true secret.
  const iranianRatesToken =
    env.EUC_IRANIAN_RATES_TOKEN ??
    process.env.EUC_IRANIAN_RATES_TOKEN ??
    "";
  const outputDirectory = performanceDiagnosticsEnabled ? "dist-perf" : "dist";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    define: {
      __EUC_DIAGNOSTICS__: JSON.stringify(diagnosticsEnabled),
      __EUC_PERF_DIAGNOSTICS__: JSON.stringify(performanceDiagnosticsEnabled),
      __EUC_IRANIAN_RATES_API_URL__: JSON.stringify(iranianRatesApiUrl),
      __EUC_IRANIAN_RATES_TOKEN__: JSON.stringify(iranianRatesToken),
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
            privacy: "privacy.html",
            background: "src/background/index.ts",
          },
          output: {
            entryFileNames: "assets/[name].js",
            chunkFileNames: "assets/[name].js",
            assetFileNames: "assets/[name].[ext]",
          },
        },
      },
  };
});
