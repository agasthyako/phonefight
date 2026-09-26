import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from any subpath (GitHub Pages, a portfolio folder, itch).
  base: "./",
  server: { allowedHosts: true },
  preview: { allowedHosts: true },
  build: {
    rollupOptions: {
      input: {
        game: resolve(import.meta.dirname, "index.html"),
        controller: resolve(import.meta.dirname, "controller.html"),
      },
    },
  },
});
