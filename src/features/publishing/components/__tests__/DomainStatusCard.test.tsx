// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// DomainStatusCard — Phase P8 tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DomainStatusCard } from "../DomainStatusCard";
import type { DeploymentDomainRecord } from "../../domain/types";

function record(status: DeploymentDomainRecord["status"], overrides: Partial<DeploymentDomainRecord> = {}): DeploymentDomainRecord {
  return {
    id: "example.com",
    projectId: "proj-1",
    providerId: "vercel",
    domain: "example.com",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = async () => {};

describe("DomainStatusCard — states", () => {
  it("shows a connected verified domain with open/copy actions", () => {
    render(
      <DomainStatusCard
        record={record("verified", { primary: true, httpsReady: true })}
        onCheckAgain={noop}
        onRemove={noop}
      />,
    );
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText(/Secure connection ready/)).toBeTruthy();
    expect(screen.getByTestId("domain-open-example.com")).toBeTruthy();
    expect(screen.getByTestId("domain-copy-example.com")).toBeTruthy();
    // Verified domains don't offer a check-again button.
    expect(screen.queryByTestId("domain-check-example.com")).toBeNull();
  });

  it("shows a pending domain as still connecting with a check-again action", () => {
    render(
      <DomainStatusCard
        record={record("pending", {
          verification: [{ type: "CNAME", name: "example.com", value: "cname.vercel-dns.com.", purpose: "Point this name at your site." }],
        })}
        onCheckAgain={noop}
        onRemove={noop}
      />,
    );
    expect(screen.getByText("Still connecting")).toBeTruthy();
    expect(screen.getByText(/DNS changes can take a little while/)).toBeTruthy();
    expect(screen.getByTestId("domain-check-example.com")).toBeTruthy();
    expect(screen.queryByTestId("domain-open-example.com")).toBeNull();
  });

  it("shows a friendly failure summary for misconfigured domains", () => {
    render(
      <DomainStatusCard
        record={record("misconfigured", { errorSummary: "One record is pointing the wrong way." })}
        onCheckAgain={noop}
        onRemove={noop}
      />,
    );
    expect(screen.getByText("One record is pointing the wrong way.")).toBeTruthy();
    expect(screen.getByTestId("domain-check-example.com")).toBeTruthy();
  });

  it("shows a fallback message when failed without a summary", () => {
    render(
      <DomainStatusCard record={record("failed")} onCheckAgain={noop} onRemove={noop} />,
    );
    expect(screen.getByText("We couldn't verify your domain yet.")).toBeTruthy();
  });
});

describe("DomainStatusCard — actions", () => {
  it("calls check-again and shows progress", async () => {
    let resolveCheck: (value: unknown) => void = () => {};
    const onCheckAgain = vi.fn(
      () => new Promise((resolve) => { resolveCheck = resolve; }),
    );
    render(
      <DomainStatusCard record={record("pending")} onCheckAgain={onCheckAgain} onRemove={noop} />,
    );
    fireEvent.click(screen.getByTestId("domain-check-example.com"));
    expect(onCheckAgain).toHaveBeenCalled();
    resolveCheck(undefined);
    await waitFor(() => {
      expect(screen.getByTestId("domain-check-example.com")).toBeTruthy();
    });
  });

  it("surfaces check errors", async () => {
    const onCheckAgain = vi.fn(async () => {
      throw new Error("Couldn't reach the domain service.");
    });
    render(
      <DomainStatusCard record={record("pending")} onCheckAgain={onCheckAgain} onRemove={noop} />,
    );
    fireEvent.click(screen.getByTestId("domain-check-example.com"));
    await waitFor(() => {
      expect(screen.getByText("Couldn't reach the domain service.")).toBeTruthy();
    });
  });

  it("calls remove", async () => {
    const onRemove = vi.fn(async () => {});
    render(
      <DomainStatusCard record={record("pending")} onCheckAgain={noop} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByTestId("domain-remove-example.com"));
    await waitFor(() => {
      expect(onRemove).toHaveBeenCalled();
    });
  });

  it("copies the https link for verified domains", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <DomainStatusCard record={record("verified")} onCheckAgain={noop} onRemove={noop} />,
    );
    fireEvent.click(screen.getByTestId("domain-copy-example.com"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.com");
    });
  });
});
