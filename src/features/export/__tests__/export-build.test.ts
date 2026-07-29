/**
 * Integration test for the export pipeline.
 *
 * Generates a complete project from MOCK_PROJECT, writes it to a temporary
 * directory, runs `npm install` and `npm run build`, and verifies the build
 * succeeds.
 *
 * This test is SKIPPED by default because it requires network access
 * (npm install) and takes ~30s. Set RUN_BUILD_TEST=true to enable:
 *   RUN_BUILD_TEST=true npx vitest run src/features/export/__tests__/export-build.test.ts
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { generateExportProject } from "../generators/project-generator";

const SHOULD_RUN = process.env.RUN_BUILD_TEST === "true";

describe("Export build integration", () => {
  it(
    "generated project builds successfully with npm install && npm run build",
    { timeout: 120_000 },
    async () => {
      if (!SHOULD_RUN) {
        console.log(
          "SKIP: Set RUN_BUILD_TEST=true to run the full build integration test.",
        );
        return;
      }

      // 1. Generate all project files
      const { folderName, files } = generateExportProject(MOCK_PROJECT);
      expect(files.length).toBeGreaterThan(0);

      // 2. Write to temp directory
      const tmpPath = mkdtempSync(join(tmpdir(), "buildora-export-test-"));
      const projectDir = join(tmpPath, folderName);

      // Ensure project root exists
      mkdirSync(projectDir, { recursive: true });

      for (const file of files) {
        const fullPath = join(projectDir, file.path);
        const dir = dirname(fullPath);
        if (dir !== projectDir) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(fullPath, file.content, "utf-8");
      }

      try {
        // 3. Build step uses the generated package.json dependencies

        // 4. Run npm install
        console.log(`[BUILD TEST] Running npm install in ${projectDir}...`);
        execSync("npm install", {
          cwd: projectDir,
          stdio: "pipe",
          timeout: 60_000,
        });

        // 5. Run npm run build
        console.log("[BUILD TEST] Running npm run build...");
        execSync("npm run build", {
          cwd: projectDir,
          stdio: "pipe",
          timeout: 120_000,
        });

        // 6. Verify build output exists
        const nextOutDir = join(projectDir, ".next");
        expect(existsSync(nextOutDir)).toBe(true);

        const buildManifest = join(nextOutDir, "build-manifest.json");
        expect(existsSync(buildManifest)).toBe(true);

        console.log("[BUILD TEST] ✅ Build succeeded!");
      } finally {
        // 7. Clean up temp directory
        console.log(`[BUILD TEST] Cleaning up ${tmpPath}...`);
        rmSync(tmpPath, { recursive: true, force: true });
      }
    },
  );
});
