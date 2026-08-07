"use client";

// ---------------------------------------------------------------------------
// SeoPreviewCards — Google-style result + social share card previews
//
// Pure presentation of deriveGooglePreview / deriveSocialPreview output.
// ---------------------------------------------------------------------------

import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { GoogleResultPreview, SocialSharePreview } from "../engine/seo-preview";

export function GoogleResultCard({ preview }: { preview: GoogleResultPreview }) {
  return (
    <div
      data-testid="seo-google-preview"
      className="rounded-xl border border-border/60 bg-base p-4"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-dim">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[9px] font-bold text-black ring-1 ring-border">
          G
        </span>
        <span>Google preview</span>
      </div>
      <p className="mt-2 truncate text-xs text-text-dim/80">{preview.url}</p>
      <p className="mt-1 line-clamp-2 cursor-pointer text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
        {preview.title || "Your site title"}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-text-muted">
        {preview.description || "Your site description will appear here."}
      </p>
      <Coaching coaching={preview.coaching} />
    </div>
  );
}

export function SocialShareCard({ preview }: { preview: SocialSharePreview }) {
  return (
    <div
      data-testid="seo-social-preview"
      className="overflow-hidden rounded-xl border border-border/60 bg-base"
    >
      <div className="flex items-center gap-1.5 px-4 pt-3 text-[11px] font-medium text-text-dim">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[9px] font-bold text-black ring-1 ring-border">
          S
        </span>
        <span>Social preview</span>
      </div>
      {preview.imageSrc ? (
        // The image source is a project asset object URL; next/image can't
        // handle object URLs, so a plain img with the project's stored alt is
        // the correct tool here.
        // eslint-disable-next-line @next/next/no-img-element -- project asset object URL
        <img
          src={preview.imageSrc}
          alt="Social share preview"
          className="mt-2 aspect-[1.91/1] w-full object-cover"
          data-testid="seo-social-image"
        />
      ) : (
        <div
          className="mt-2 flex aspect-[1.91/1] w-full items-center justify-center bg-card/50 text-xs text-text-dim/60"
          data-testid="seo-social-image-placeholder"
        >
          No image yet
        </div>
      )}
      <div className="p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-text-dim">
          {preview.siteName}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm font-medium text-text-primary">
          {preview.title || "Share title"}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-text-muted">
          {preview.description || "Share description will appear here."}
        </p>
      </div>
      <Coaching coaching={preview.coaching} />
    </div>
  );
}

function Coaching({ coaching }: { coaching: string[] }) {
  if (coaching.length === 0) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Looks good
      </div>
    );
  }
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {coaching.map((tip) => (
        <li
          key={tip}
          className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {tip}
        </li>
      ))}
    </ul>
  );
}
