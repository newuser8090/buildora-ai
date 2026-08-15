/**
 * Integration test for the export pipeline.
 *
 * Runs ONE full `npm install` + `npm run build` cycle on a GENERATED
 * multi-page site (Phase P22-I — the real deterministic pipeline), and
 * statically verifies the asset-export behavior of a second project. A single
 * build keeps the gate bounded: on this Windows environment a fresh `npm
 * install` in a temp dir measures ~4-5 minutes (network-bound), so two full
 * install+build cycles would not fit in one test run and would double the
 * gate duration for the same coverage.
 *
 * This test is SKIPPED by default because it requires network access
 * (npm install) and takes several minutes. Set RUN_BUILD_TEST=true to enable:
 *   npm run test:export-build
 *
 * Child processes are executed ASYNCHRONOUSLY via child_process.spawn rather
 * than synchronously. A synchronous child-process call (execSync) blocks the
 * Vitest worker event loop for the entire install/build duration, which
 * prevents the internal task-update message from being delivered and surfaces
 * as:  Error: [vitest-worker]: Timeout calling "onTaskUpdate".
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
import { generateProject } from "@/features/generation/generators/project-generator";
import { analyzeSitePrompt } from "@/features/generation/analyzers/prompt-analyzer";

const SHOULD_RUN = process.env.RUN_BUILD_TEST === "true";

// On Windows, npm is exposed as a .cmd shim. Windows cannot exec .cmd files
// directly (execFile fails with EINVAL), so the shell is genuinely required
// there; on POSIX we spawn the binary directly with no shell.
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const USE_SHELL = process.platform === "win32";

// Measured on the CI/Windows environment: a fresh `npm install` in a temp
// dir is network-bound and took ~275s; `npm run build` ~20s. The per-step cap
// must exceed the install time (the previous 170s cap would kill a genuine
// install), while the per-test timeout (below) also budgets the slow
// node_modules deletion on Windows.
const COMMAND_TIMEOUT_MS = 480_000;

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

/**
 * Remove a temp project directory with retries.
 *
 * On Windows, node_modules contains many files and the npm child may briefly
 * hold handles after exit, so a single rmSync can race with ENOTEMPTY. A
 * failed cleanup must never fail the build gate — leftover OS temp dirs are
 * harmless — so final attempts are logged and ignored.
 */
async function removeDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch (err) {
      if (attempt === 4) {
        console.warn(
          `[BUILD TEST] Temp cleanup failed (ignored): ${dir} — ${(err as Error).message}`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// ---------------------------------------------------------------------------
// Mock project with assets for the asset-export assertions
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
    "generated multi-page site + asset export: one npm install && npm run build",
    // Justified by measurement: a fresh temp-dir `npm install` is network-bound
    // (~275s on this Windows env), `npm run build` ~20s, and Windows node_modules
    // deletion ~90s. A single build needs ~7 min of budget; two full install+build
    // cycles would not fit a single gate run and would double its duration.
    { timeout: 600_000 },
    async () => {
      if (!SHOULD_RUN) {
        console.log(
          "SKIP: Set RUN_BUILD_TEST=true to run the full build integration test.",
        );
        return;
      }

      // ---------------------------------------------------------------
      // Part A — generate a multi-page site through the REAL deterministic
      // pipeline (Phase P22-I: rule-based site plan → project generator) and
      // verify one export route per page.
      // ---------------------------------------------------------------
      const plan = analyzeSitePrompt(
        "Build a multi-page SaaS website for Nimbus with features, pricing, about, and contact pages",
      );
      const project = generateProject(plan);
      expect(project.pages.length).toBeGreaterThanOrEqual(2);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const siteExport = generateExportProject(project as any);
      const files = siteExport.files;

      expect(files.some((f) => f.path === "app/page.tsx")).toBe(true);
      const pageFiles = files.filter(
        (f) => f.path.startsWith("app/") && f.path.endsWith("/page.tsx"),
      );
      expect(pageFiles.length).toBe(project.pages.length);
      for (const page of project.pages.slice(1)) {
        expect(
          files.some((f) => f.path === `app${page.slug}/page.tsx`),
        ).toBe(true);
      }

      // ---------------------------------------------------------------
      // Part B — statically verify the asset-export behavior (no build
      // needed: these are pure export-file assertions).
      // ---------------------------------------------------------------
      const assetProject = createProjectWithAssets();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { files: assetFiles2 } = generateExportProject(assetProject as any);
      expect(assetFiles2.length).toBeGreaterThan(0);

      // Verify asset files are included
      const assetFiles = assetFiles2.filter((f) => f.path.startsWith("public/assets/"));
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
      const pageFile = assetFiles2.find((f) => f.path === "app/page.tsx");
      expect(pageFile).toBeDefined();
      expect(pageFile!.content).toContain("/assets/");
      expect(pageFile!.content).not.toContain("data:image/");

      // Verify generated section components have no next/image imports
      const sectionFiles = assetFiles2.filter((f) => f.path.startsWith("components/sections/"));
      for (const sf of sectionFiles) {
        expect(sf.content).not.toContain("next/image");
      }

      // ---------------------------------------------------------------
      // Part C — ONE install + ONE build on the generated multi-page site.
      // ---------------------------------------------------------------
      const tmpPath = mkdtempSync(join(tmpdir(), "buildora-export-site-"));
      const projectDir = join(tmpPath, siteExport.folderName);

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

        // Run npm install (async — event loop stays responsive)
        console.log(`[BUILD TEST] Running npm install in ${projectDir}...`);
        await runCommand(NPM_COMMAND, ["install"], projectDir);

        // Run npm run build (async)
        console.log("[BUILD TEST] Running npm run build...");
        await runCommand(NPM_COMMAND, ["run", "build"], projectDir);

        // Verify build output exists
        const nextOutDir = join(projectDir, ".next");
        expect(existsSync(nextOutDir)).toBe(true);

        const buildManifest = join(nextOutDir, "build-manifest.json");
        expect(existsSync(buildManifest)).toBe(true);

        console.log("[BUILD TEST] ✅ Multi-page site build succeeded!");
      } finally {
        // Clean up temp directory — only after the child process has fully
        // exited (runCommand resolves/rejects only on completion).
        console.log(`[BUILD TEST] Cleaning up ${tmpPath}...`);
        await removeDirWithRetry(tmpPath);
      }
    },
  );
});
