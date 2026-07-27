import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this from a sub-path (yourname.github.io/repo-name/),
  // so asset links need to be relative rather than rooted at "/".
  base: "./",
});
