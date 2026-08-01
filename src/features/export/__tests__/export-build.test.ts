/**
 * Integration test for the export pipeline.
 *
 * Generates a complete project from a mock project (with assets), writes it
 * to a temporary directory, runs `npm install` and `npm run build`, and
 * verifies the build succeeds.
 *
 * This test is SKIPPED by default because it requires network access
 * (npm install) and takes ~90s. Set RUN_BUILD_TEST=true to enable:
 *   npm run test:export-build
 *
 * Child processes are executed ASYNCHRONOUSLY via child_process.spawn rather
 * than synchronously. A synchronous child-process call (execSync) blocks the
 * Vitest worker event loop for the entire install/build duration (~80-95s),
 * which prevents the internal task-update message from being delivered and
 * surfaces as:  Error: [vitest-worker]: Timeout calling "onTaskUpdate".
 *
 * On Windows, npm is a .cmd shim that cannot be exec'd directly (EINVAL), so
 * the child is spawned through cmd.exe (shell: true) there; on POSIX it is
 * spawned directly with no shell.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { generateExportProject } from "../generators/project-generator";

const SHOULD_RUN = process.env.RUN_BUILD_TEST === "true";

// On Windows, npm is exposed as a .cmd shim. Windows cannot exec .cmd files
// directly (execFile fails with EINVAL), so the shell is genuinely required
// there; on POSIX we spawn the binary directly with no shell.
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const USE_SHELL = process.platform === "win32";

const COMMAND_TIMEOUT_MS = 170_000;

/**
 * Runs a command asynchronously.
 *
 * - Arguments are passed as an array (shell-safe; no string interpolation).
 * - Resolves with captured stdout/stderr after the child fully exits.
 * - Rejects on non-zero exit code or timeout, including output in the error.
 * - Uses a shell ONLY on Windows, where .cmd shims require cmd.exe.
 * - Kills the child on timeout so cleanup never races a live process.
 * - Keeps the Node/Vitest event loop responsive (no sync process APIs).
 */
function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: USE_SHELL,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `Command timed out after ${COMMAND_TIMEOUT_MS}ms: ` +
            `${command} ${args.join(" ")} (cwd=${cwd})`,
        ),
      );
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `Failed to start: ${command} ${args.join(" ")} (cwd=${cwd}): ${err.message}`,
        ),
      );
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `Command failed: ${command} ${args.join(" ")} ` +
            `(cwd=${cwd}, exit=${code ?? "unknown"}${signal ? `, signal=${signal}` : ""})` +
            (stdout ? `\n\n--- stdout ---\n${stdout}` : "") +
            (stderr ? `\n\n--- stderr ---\n${stderr}` : ""),
        ),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Create a mock project with assets for the integration test
// ---------------------------------------------------------------------------

function createProjectWithAssets() {
  return {
    ...MOCK_PROJECT,
    name: "Buildora Export Test",
    assets: [
      {
        id: "asset-logo",
        name: "logo.png",
        type: "logo" as const,
        mimeType: "image/png",
        extension: ".png",
        size: 1024,
        source: { type: "data-url" as const, value: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "asset-hero",
        name: "hero.webp",
        type: "image" as const,
        mimeType: "image/webp",
        extension: ".webp",
        size: 2048,
        width: 800,
        height: 600,
        source: { type: "data-url" as const, value: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4TBgAAAAvAAAAEAAQAAAAADHBAgAADHDcAAAAAA==" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "asset-icon",
        name: "icon.svg",
        type: "icon" as const,
        mimeType: "image/svg+xml",
        extension: ".svg",
        size: 256,
        source: { type: "data-url" as const, value: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iIzdjNWNmYyIvPjwvc3ZnPg==" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "asset-bg",
        name: "bg.jpg",
        type: "background" as const,
        mimeType: "image/jpeg",
        extension: ".jpg",
        size: 4096,
        source: { type: "data-url" as const, value: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA=" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "asset-unused",
        name: "unused.png",
        type: "image" as const,
        mimeType: "image/png",
        extension: ".png",
        size: 512,
        source: { type: "data-url" as const, value: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    pages: [
      {
        ...MOCK_PROJECT.pages[0],
        sections: [
          // Header with logo asset
          {
            ...MOCK_PROJECT.pages[0].sections[0],
            props: {
              logoText: "Buildora",
              logoImage: { assetId: "asset-logo", altText: "Buildora logo" },
              navLinks: [
                { text: "Features", href: "#features" },
                { text: "Pricing", href: "#pricing" },
              ],
              ctaText: "Get Started",
              ctaHref: "#cta",
            },
          },
          // Hero with hero image + background asset, plus legacy URL
          {
            ...MOCK_PROJECT.pages[0].sections[1],
            props: {
              headline: "Build with AI",
              subheadline: "Describe, generate, publish.",
              primaryCta: { text: "Start Free", href: "#" },
              heroImage: { assetId: "asset-hero", altText: "Hero screenshot" },
              backgroundImage: { assetId: "asset-bg" },
            },
          },
          // Features with one icon asset
          {
            ...MOCK_PROJECT.pages[0].sections[2],
            props: {
              title: "Features",
              features: [
                { title: "Fast", description: "Lightning speed", icon: "Zap", iconImage: { assetId: "asset-icon", altText: "Lightning" } },
                { title: "Secure", description: "Safe", icon: "Shield" },
              ],
            },
          },
          // CTA with background asset
          {
            ...MOCK_PROJECT.pages[0].sections[5],
            props: {
              headline: "Ready?",
              subheadline: "Start building today.",
              ctaText: "Get Started",
              ctaHref: "#",
              backgroundImage: { assetId: "asset-bg" },
            },
          },
          // Footer reusing logo
          {
            ...MOCK_PROJECT.pages[0].sections[6],
            props: {
              text: "© 2026 Buildora",
              logoImage: { assetId: "asset-logo", altText: "Buildora logo" },
              links: [
                { text: "Twitter", href: "#" },
                { text: "GitHub", href: "#" },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("Export build integration", () => {
  it(
    "generated project builds successfully with npm install && npm run build",
    { timeout: 180_000 },
    async () => {
      if (!SHOULD_RUN) {
        console.log(
          "SKIP: Set RUN_BUILD_TEST=true to run the full build integration test.",
        );
        return;
      }

      // 1. Generate all project files (including assets)
      const project = createProjectWithAssets();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { folderName, files } = generateExportProject(project as any);
      expect(files.length).toBeGreaterThan(0);

      // Verify asset files are included
      const assetFiles = files.filter((f) => f.path.startsWith("public/assets/"));
      expect(assetFiles.length).toBeGreaterThan(0);
      // Verify unused asset is excluded
      expect(assetFiles.some((f) => f.path.includes("unused"))).toBe(false);
      // Verify used assets are present
      expect(assetFiles.some((f) => f.path.includes("logo.png"))).toBe(true);
      expect(assetFiles.some((f) => f.path.includes("hero.webp"))).toBe(true);
      expect(assetFiles.some((f) => f.path.includes("icon.svg"))).toBe(true);
      expect(assetFiles.some((f) => f.path.includes("bg.jpg"))).toBe(true);
      // Duplicate asset (logo reused in footer) should not create duplicate files
      expect(assetFiles.filter((f) => f.path.includes("logo.png"))).toHaveLength(1);

      // Verify generated page.tsx has /assets/ paths instead of data URLs
      const pageFile = files.find((f) => f.path === "app/page.tsx");
      expect(pageFile).toBeDefined();
      expect(pageFile!.content).toContain("/assets/");
      expect(pageFile!.content).not.toContain("data:image/");

      // Verify generated section components have no next/image imports
      const sectionFiles = files.filter((f) => f.path.startsWith("components/sections/"));
      for (const sf of sectionFiles) {
        expect(sf.content).not.toContain("next/image");
      }

      // 2. Write to temp directory
      const tmpPath = mkdtempSync(join(tmpdir(), "buildora-export-test-"));
      const projectDir = join(tmpPath, folderName);

      try {
        // Ensure project root exists
        mkdirSync(projectDir, { recursive: true });

        for (const file of files) {
          const fullPath = join(projectDir, file.path);
          const dir = dirname(fullPath);
          if (dir !== projectDir) {
            mkdirSync(dir, { recursive: true });
          }
          if (file.encoding === "base64") {
            // Decode base64 content back to binary for the filesystem
            const binary = Buffer.from(file.content, "base64");
            writeFileSync(fullPath, binary);
          } else {
            writeFileSync(fullPath, file.content, "utf-8");
          }
        }

        // 3. Run npm install (async — event loop stays responsive)
        console.log(`[BUILD TEST] Running npm install in ${projectDir}...`);
        await runCommand(NPM_COMMAND, ["install"], projectDir);

        // 4. Run npm run build (async)
        console.log("[BUILD TEST] Running npm run build...");
        await runCommand(NPM_COMMAND, ["run", "build"], projectDir);

        // 5. Verify build output exists
        const nextOutDir = join(projectDir, ".next");
        expect(existsSync(nextOutDir)).toBe(true);

        const buildManifest = join(nextOutDir, "build-manifest.json");
        expect(existsSync(buildManifest)).toBe(true);

        console.log("[BUILD TEST] ✅ Build succeeded!");
      } finally {
        // 6. Clean up temp directory — only after the child process has fully
        //    exited (runCommand resolves/rejects only on completion).
        console.log(`[BUILD TEST] Cleaning up ${tmpPath}...`);
        rmSync(tmpPath, { recursive: true, force: true });
      }
    },
  );
});
