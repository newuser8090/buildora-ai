// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// SeoPreviewCards — Google + social preview rendering (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoogleResultCard, SocialShareCard } from "../SeoPreviewCards";

describe("GoogleResultCard", () => {
  it("renders title, url, and description with a positive coaching state", () => {
    render(
      <GoogleResultCard
        preview={{
          title: "My Site — Home",
          url: "https://example.com/",
          description: "A great description.",
          usingFallback: false,
          coaching: [],
        }}
      />,
    );
    expect(screen.getByTestId("seo-google-preview")).toBeTruthy();
    expect(screen.getByText("My Site — Home")).toBeTruthy();
    expect(screen.getByText("https://example.com/")).toBeTruthy();
    expect(screen.getByText("A great description.")).toBeTruthy();
    expect(screen.getByText("Looks good")).toBeTruthy();
  });

  it("shows fallback copy when values are empty", () => {
    render(<GoogleResultCard preview={{ title: "", url: "", description: "", usingFallback: true, coaching: [] }} />);
    expect(screen.getByText("Your site title")).toBeTruthy();
    expect(screen.getByText("Your site description will appear here.")).toBeTruthy();
  });

  it("surfaces coaching tips when present", () => {
    render(
      <GoogleResultCard
        preview={{
          title: "T",
          url: "u",
          description: "",
          usingFallback: true,
          coaching: ["Your title may get cut off."],
        }}
      />,
    );
    expect(screen.getByText("Your title may get cut off.")).toBeTruthy();
    expect(screen.queryByText("Looks good")).toBeNull();
  });
});

describe("SocialShareCard", () => {
  it("renders an image when an image source exists", () => {
    render(
      <SocialShareCard
        preview={{
          imageSrc: "data:image/png;base64,AAAA",
          siteName: "My Site",
          title: "Share title",
          description: "Share desc",
          usingFallback: false,
          coaching: [],
        }}
      />,
    );
    expect(screen.getByTestId("seo-social-image")).toBeTruthy();
    expect(screen.queryByTestId("seo-social-image-placeholder")).toBeNull();
    expect(screen.getByText("My Site")).toBeTruthy();
    expect(screen.getByText("Share title")).toBeTruthy();
  });

  it("shows a placeholder when there is no image", () => {
    render(
      <SocialShareCard
        preview={{ imageSrc: undefined, siteName: "S", title: "", description: "", usingFallback: true, coaching: [] }}
      />,
    );
    expect(screen.getByTestId("seo-social-image-placeholder")).toBeTruthy();
    expect(screen.queryByTestId("seo-social-image")).toBeNull();
  });

  it("renders fallback text when title/description are empty", () => {
    render(
      <SocialShareCard
        preview={{ imageSrc: undefined, siteName: "S", title: "", description: "", usingFallback: true, coaching: [] }}
      />,
    );
    expect(screen.getByText("Share title")).toBeTruthy();
    expect(screen.getByText("Share description will appear here.")).toBeTruthy();
  });
});
