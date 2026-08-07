// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — AddBlocksToLibraryDialog tests
//
// Owner picker: lists the user's own saved pieces, marks pieces that have
// not synced yet ("Sync first"), and adds only synced pieces through the
// provider (permission is enforced server-side). Local-only mode stays safe:
// no provider → a clear message, never a fake success.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddBlocksToLibraryDialog } from "../components/AddBlocksToLibraryDialog";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";
import { setCloudProviderForTests } from "@/features/cloud-sync/providers/provider-factory";
import { InMemoryCloudLibraryProvider } from "@/features/cloud-sync/providers/in-memory-cloud-provider";
import { setMyBlocksAdapterForTests } from "@/features/my-blocks/storage/my-blocks-singleton";
import { InMemoryMyBlocksAdapter, makeTree } from "@/features/my-blocks/__tests__/helpers";
import { useAuthStore } from "@/features/auth/auth-store";

const SESSION = {
  user: { id: "user-1", email: "owner@example.com", emailVerified: true },
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-08T00:00:00.000Z",
} as const;

function signInStore() {
  useAuthStore.setState({ status: "signed-in", session: SESSION as never, error: null });
}

function seedLocalBlocks(): string[] {
  const adapter = new InMemoryMyBlocksAdapter();
  const ids: string[] = [];
  void adapter.createMyBlock({
    name: "Shared Hero",
    category: "layout",
    tree: makeTree(),
    idFactory: () => {
      ids.push("block-hero");
      return "block-hero";
    },
  });
  void adapter.createMyBlock({
    name: "Local Only Card",
    category: "cards",
    tree: makeTree(),
    idFactory: () => {
      ids.push("block-local");
      return "block-local";
    },
  });
  setMyBlocksAdapterForTests(adapter);
  return ids;
}

async function seedProvider(libraryName = "Team Kit") {
  const provider = new InMemoryCloudLibraryProvider();
  provider.setCurrentUser({ id: "user-1", email: "owner@example.com" });
  const library = await provider.createSharedLibrary({ name: libraryName });
  // The owner's synced block lives in the cloud (cloud id = "cloud-hero-1").
  provider.blocks.set("cloud-hero-1", {
    id: "cloud-hero-1",
    schemaVersion: 1,
    name: "Shared Hero",
    category: "layout",
    tags: [],
    tree: makeTree(),
    previewMetadata: { blockCount: 3, rootType: "container", containsMedia: false, containsInteractive: false },
    contentRevision: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    clientUpdatedAt: "2026-08-01T00:00:00.000Z",
  });
  setCloudProviderForTests(provider);
  return { provider, library };
}

describe("AddBlocksToLibraryDialog", () => {
  beforeEach(() => {
    useSharedLibrariesUiStore.setState({
      addBlocksDialog: null,
      panelOpen: false,
    });
    setCloudProviderForTests(null);
    setMyBlocksAdapterForTests(null);
    useAuthStore.setState({ status: "signed-out", session: null, error: null });
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <AddBlocksToLibraryDialog libraryId="lib-1" onAdded={vi.fn()} resolveCloudId={async () => null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists the user's saved pieces with beginner copy", async () => {
    signInStore();
    seedLocalBlocks();
    useSharedLibrariesUiStore.setState({ addBlocksDialog: { libraryId: "lib-1" } });
    render(
      <AddBlocksToLibraryDialog
        libraryId="lib-1"
        onAdded={vi.fn()}
        resolveCloudId={async (_, blockId) => (blockId === "block-hero" ? "cloud-hero-1" : null)}
      />,
    );
    expect(screen.getByRole("heading", { name: "Add saved pieces" })).toBeTruthy();
    expect(screen.getByText(/Choose pieces from your own saved blocks/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Shared Hero")).toBeTruthy();
    });
    expect(screen.getByText("Local Only Card")).toBeTruthy();
  });

  it("marks not-yet-synced pieces as 'Sync first' and gives them no checkbox", async () => {
    signInStore();
    seedLocalBlocks();
    useSharedLibrariesUiStore.setState({ addBlocksDialog: { libraryId: "lib-1" } });
    render(
      <AddBlocksToLibraryDialog
        libraryId="lib-1"
        onAdded={vi.fn()}
        resolveCloudId={async (_, blockId) => (blockId === "block-hero" ? "cloud-hero-1" : null)}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Local Only Card")).toBeTruthy();
    });
    // The synced piece is selectable; the unsynced piece only shows a hint
    // (no checkbox at all — it can never be selected or added).
    const syncFirstHint = screen.getAllByText("Sync first");
    expect(syncFirstHint.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("add-blocks-block-block-local")).toBeNull();
    expect(screen.getByTestId("add-blocks-block-block-hero")).toBeTruthy();
  });

  it("adds selected synced pieces via the provider and reports success", async () => {
    signInStore();
    seedLocalBlocks();
    const { provider, library } = await seedProvider();
    const onAdded = vi.fn();
    useSharedLibrariesUiStore.setState({ addBlocksDialog: { libraryId: library.id } });
    render(
      <AddBlocksToLibraryDialog
        libraryId={library.id}
        onAdded={onAdded}
        resolveCloudId={async () => "cloud-hero-1"}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Shared Hero")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("add-blocks-block-block-hero"));
    expect((screen.getByTestId("add-blocks-block-block-hero") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("add-blocks-submit"));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
    const stored = provider.libraries.get(library.id);
    expect(stored?.blockIds).toContain("cloud-hero-1");
    // The dialog closes after a successful add.
    expect(useSharedLibrariesUiStore.getState().addBlocksDialog).toBeNull();
  });

  it("reports a safe message when cloud backup isn't configured (local-only mode)", async () => {
    signInStore();
    seedLocalBlocks();
    useSharedLibrariesUiStore.setState({ addBlocksDialog: { libraryId: "lib-1" } });
    const onAdded = vi.fn();
    render(
      <AddBlocksToLibraryDialog
        libraryId="lib-1"
        onAdded={onAdded}
        resolveCloudId={async () => "cloud-hero-1"}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Shared Hero")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("add-blocks-block-block-hero"));
    fireEvent.click(screen.getByTestId("add-blocks-submit"));
    await waitFor(() => {
      expect(
        screen.getByText("Cloud backup isn't configured for this app yet."),
      ).toBeTruthy();
    });
    expect(onAdded).not.toHaveBeenCalled();
  });
});
