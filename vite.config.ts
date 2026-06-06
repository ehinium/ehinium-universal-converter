import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        popup: "index.html",
        content: "src/content/index.ts",
      },
      output: {
        entryFileNames: "assets/[name].js",
      },
    },
  },
});