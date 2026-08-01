// ---------------------------------------------------------------------------
// ThumbnailGenerationService
//
// Orchestrates a single thumbnail generation:
//   1. create isolated offscreen render target
//   2. render <ThumbnailProjectPreview> (first page, visible sections, theme)
//   3. wait for readiness (fonts/images) with a bounded timeout
//   4. capture the node to a canvas (injectable capture fn)
//   5. encode to WebP/PNG (injectable encoder fn)
//   6. validate the output (non-empty, deterministic dimensions)
//   7. clean up (unmount root, remove container)
//   8. return a ProjectThumbnailRecord
//
// This service NEVER persists the thumbnail — generation and storage are
// separate concerns (the scheduler persists).
//
// All browser/canvas work is injectable so unit tests run headless.
// ---------------------------------------------------------------------------

import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThumbnailProjectPreview } from "../rendering/ThumbnailProjectPreview";
import { captureNode, type CaptureFn } from "../rendering/thumbnail-capture";
import { encodeThumbnail, type ThumbnailEncoderFn } from "./thumbnail-encoder";
import {
  THUMBNAIL_SOURCE_WIDTH,
  THUMBNAIL_SOURCE_HEIGHT,
  THUMBNAIL_RENDER_TIMEOUT_MS,
  THUMBNAIL_ASSET_WAIT_TIMEOUT_MS,
} from "../constants";
import { thumbnailErrors, toThumbnailError } from "../errors";
import type {
  GenerateThumbnailRequest,
  GenerateThumbnailResult,
  ProjectThumbnailRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

export interface ThumbnailGenerationDeps {
  capture: CaptureFn;
  encode: ThumbnailEncoderFn;
  /** Creates an offscreen container for the preview. */
  createContainer: () => HTMLElement;
  /** Removes the container from the DOM. */
  removeContainer: (el: HTMLElement) => void;
  /** Waits for fonts/images readiness. Bounded by the caller's timeout. */
  waitForReadiness: (el: HTMLElement, timeoutMs: number) => Promise<void>;
  /** Renders the preview into the container (React root lifecycle). */
  mountPreview: (
    container: HTMLElement,
    request: GenerateThumbnailRequest,
  ) => Root;
  now: () => string;
}

// ---------------------------------------------------------------------------
// Browser default deps
// ---------------------------------------------------------------------------

function createOffscreenContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-100000px";
  el.style.top = "0";
  el.style.width = `${THUMBNAIL_SOURCE_WIDTH}px`;
  el.style.height = `${THUMBNAIL_SOURCE_HEIGHT}px`;
  el.style.pointerEvents = "none";
  el.style.zIndex = "-2147483647";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

async function waitForReadiness(
  el: HTMLElement,
  timeoutMs: number,
): Promise<void> {
  // Wait one microtask for the render to flush, then fonts + images.
  await new Promise((r) => setTimeout(r, 0));

  const promises: Promise<unknown>[] = [];

  if (typeof document !== "undefined" && document.fonts) {
    promises.push(
      Promise.race([
        document.fonts.ready as Promise<unknown>,
        new Promise((r) => setTimeout(r, timeoutMs)),
      ]),
    );
  }

  // Wait for referenced images to load or fail (bounded).
  const images = Array.from(el.querySelectorAll("img"));
  const imageWaiters = images.map((img) => {
    if (img.complete) return Promise.resolve();
    return Promise.race([
      new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      }),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  });
  promises.push(...imageWaiters);

  // Small settle delay so the layout is stable before capture.
  promises.push(new Promise((r) => setTimeout(r, 50)));

  await Promise.race([
    Promise.all(promises),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

const browserDeps: ThumbnailGenerationDeps = {
  capture: captureNode,
  encode: encodeThumbnail,
  createContainer: createOffscreenContainer,
  removeContainer: (el) => el.remove(),
  waitForReadiness,
  mountPreview: (container, request) => {
    const root = createRoot(container);
    const element: ReactElement = createElement(ThumbnailProjectPreview, {
      project: request.project,
      width: THUMBNAIL_SOURCE_WIDTH,
      height: THUMBNAIL_SOURCE_HEIGHT,
    });
    root.render(element);
    return root;
  },
  now: () => new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ThumbnailGenerationService {
  private deps: ThumbnailGenerationDeps;

  constructor(deps: Partial<ThumbnailGenerationDeps> = {}) {
    this.deps = { ...browserDeps, ...deps };
  }

  async generate(
    request: GenerateThumbnailRequest,
  ): Promise<GenerateThumbnailResult> {
    const { project, revision } = request;

    if (!project) {
      return {
        ok: false,
        error: thumbnailErrors.renderTargetUnavailable(undefined, revision),
      };
    }
    const projectId = project.id;

    if (typeof document === "undefined") {
      return {
        ok: false,
        error: thumbnailErrors.renderTargetUnavailable(projectId, revision),
      };
    }

    let container: HTMLElement | null = null;
    let root: Root | null = null;

    try {
      container = this.deps.createContainer();
      root = this.deps.mountPreview(container, request);

      await this.deps.waitForReadiness(
        container,
        THUMBNAIL_ASSET_WAIT_TIMEOUT_MS,
      );

      // Bounded timeout. The timer is cleared when capture wins so the
      // loser never rejects an unobserved promise (no unhandled rejection).
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            thumbnailErrors.renderFailed(
              projectId,
              revision,
              "Rendering exceeded the capture timeout.",
            ),
          );
        }, THUMBNAIL_RENDER_TIMEOUT_MS);
      });

      const capturePromise = this.deps
        .capture({
          node: container,
          width: THUMBNAIL_SOURCE_WIDTH,
          height: THUMBNAIL_SOURCE_HEIGHT,
          timeoutMs: THUMBNAIL_RENDER_TIMEOUT_MS,
        })
        .catch((err: unknown) => {
          // Capture/render failures map to RENDER_FAILED — never a generic
          // error — so the scheduler can surface a meaningful, retryable code.
          throw thumbnailErrors.renderFailed(
            projectId,
            revision,
            err instanceof Error ? err.message : String(err),
          );
        })
        .then(({ canvas }) => {
          return this.deps.encode({ canvas });
        })
        .catch((err: unknown) => {
          // A throwing encoder maps to ENCODING_FAILED. Structured encoder
          // errors are returned via the result path (never thrown), so this
          // only fires for genuine encode exceptions.
          if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            "message" in err
          ) {
            throw err;
          }
          throw thumbnailErrors.encodingFailed(
            projectId,
            revision,
            err instanceof Error ? err.message : String(err),
          );
        });

      let encoded;
      try {
        encoded = await Promise.race([capturePromise, timeoutPromise]);
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }

      if (!encoded.ok) {
        return { ok: false, error: encoded.error };
      }

      const record: ProjectThumbnailRecord = {
        projectId,
        revision,
        generatedAt: this.deps.now(),
        mimeType: encoded.mimeType,
        width: encoded.width,
        height: encoded.height,
        byteSize: encoded.byteSize,
        data: encoded.blob,
      };

      return { ok: true, record };
    } catch (err) {
      return {
        ok: false,
        error: toThumbnailError(err, "UNKNOWN_THUMBNAIL_ERROR", {
          projectId,
          revision,
          retryable: true,
        }),
      };
    } finally {
      // Always clean up: unmount the React root and remove the container.
      try {
        root?.unmount();
      } catch {
        // Ignore unmount errors during cleanup.
      }
      if (container) {
        try {
          this.deps.removeContainer(container);
        } catch {
          // Ignore removal errors during cleanup.
        }
      }
    }
  }
}
