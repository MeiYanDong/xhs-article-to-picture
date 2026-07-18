import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Domain tests intentionally run without a simulated browser. This keeps
    // file-write and parser behavior deterministic; real DOM coverage lives in
    // the Playwright pass against Chrome.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "*.test.ts"],
    restoreMocks: true,
  },
});
