import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Operational .mjs checks use node:test and run with node --test.
    exclude: [...configDefaults.exclude, "scripts/*.test.mjs"],
    environment: "node",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@/src": path.resolve(__dirname, "./src"),
      "@/app": path.resolve(__dirname, "./app"),
    },
  },
});
