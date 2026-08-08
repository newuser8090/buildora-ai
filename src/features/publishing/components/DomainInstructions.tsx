"use client";

// ---------------------------------------------------------------------------
// DomainInstructions — beginner-safe DNS instructions (Phase P8)
//
// Explains in plain language: "Open the place where you bought your domain
// and add this record." Advanced type names (CNAME/TXT) are shown but the
// copy never assumes DNS knowledge. Buildora never modifies DNS itself.
// ---------------------------------------------------------------------------

import type { DomainVerificationInstruction } from "../domain/types";

export interface DomainInstructionsProps {
  instructions: DomainVerificationInstruction[];
  domain: string;
}

export function DomainInstructions({ instructions, domain }: DomainInstructionsProps) {
  if (instructions.length === 0) {
    return (
      <p className="text-xs text-text-muted">
        No extra settings are needed right now — give DNS a moment to catch up.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="domain-instructions">
      <p className="text-xs leading-relaxed text-text-muted">
        Open the place where you bought <span className="font-medium text-text-primary">{domain}</span>{" "}
        (your domain provider), find the <strong>DNS records</strong> section, and add{" "}
        {instructions.length === 1 ? "this record" : "these records"}:
      </p>
      {instructions.map((instruction, index) => (
        <div
          key={`${instruction.type}-${index}`}
          className="rounded-lg border border-border/60 bg-base p-3"
          data-testid="domain-instruction"
        >
          <p className="text-[11px] font-medium text-text-primary">
            {instruction.purpose}
          </p>
          <dl className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <dt className="flex-shrink-0 text-[11px] text-text-dim">Type</dt>
              <dd className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px] text-accent">
                {instruction.type}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="flex-shrink-0 text-[11px] text-text-dim">Name</dt>
              <dd className="min-w-0 break-all text-right font-mono text-[11px] text-text-primary">
                {instruction.name}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="flex-shrink-0 text-[11px] text-text-dim">Value</dt>
              <dd className="min-w-0 break-all text-right font-mono text-[11px] text-text-primary">
                {instruction.value}
              </dd>
            </div>
          </dl>
        </div>
      ))}
      <p className="text-[11px] text-text-dim">
        DNS changes can take a little while to spread. You can keep editing —
        the domain will connect on its own.
      </p>
    </div>
  );
}
