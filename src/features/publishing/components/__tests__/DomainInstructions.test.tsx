// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// DomainInstructions — Phase P8 tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DomainInstructions } from "../DomainInstructions";
import type { DomainVerificationInstruction } from "../../domain/types";

const CNAME: DomainVerificationInstruction = {
  type: "CNAME",
  name: "example.com",
  value: "cname.vercel-dns.com.",
  purpose: "Point this name at your site.",
};

const TXT: DomainVerificationInstruction = {
  type: "TXT",
  name: "_vercel",
  value: "vc-domain-verify=buildora",
  purpose: "Prove you own this domain.",
};

describe("DomainInstructions", () => {
  it("explains in plain language where to add the record", () => {
    render(<DomainInstructions instructions={[CNAME]} domain="example.com" />);
    expect(screen.getByText(/Open the place where you bought/)).toBeTruthy();
    // The domain appears in the copy AND as the CNAME name.
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(screen.getByText(/domain provider/)).toBeTruthy();
    expect(screen.getByText(/DNS records/)).toBeTruthy();
  });

  it("renders type/name/value for each instruction", () => {
    render(<DomainInstructions instructions={[CNAME, TXT]} domain="example.com" />);
    expect(screen.getAllByTestId("domain-instruction")).toHaveLength(2);
    expect(screen.getByText("CNAME")).toBeTruthy();
    expect(screen.getByText("TXT")).toBeTruthy();
    expect(screen.getByText("cname.vercel-dns.com.")).toBeTruthy();
    expect(screen.getByText("vc-domain-verify=buildora")).toBeTruthy();
    expect(screen.getByText("_vercel")).toBeTruthy();
  });

  it("uses singular copy for a single record", () => {
    render(<DomainInstructions instructions={[CNAME]} domain="example.com" />);
    expect(screen.getByText(/add this record:/)).toBeTruthy();
  });

  it("mentions that DNS changes take time and editing can continue", () => {
    render(<DomainInstructions instructions={[CNAME]} domain="example.com" />);
    expect(screen.getByText(/DNS changes can take a little while/)).toBeTruthy();
    expect(screen.getByText(/keep editing/)).toBeTruthy();
  });

  it("handles an empty instruction list gracefully", () => {
    render(<DomainInstructions instructions={[]} domain="example.com" />);
    expect(screen.getByText(/No extra settings are needed/)).toBeTruthy();
  });
});
