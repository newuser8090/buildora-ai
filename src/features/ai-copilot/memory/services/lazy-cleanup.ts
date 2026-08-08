// ---------------------------------------------------------------------------
// AI Copilot — lazy memory cleanup (Phase P11)
//
// Imported by the persistence controller so project deletion removes the
// project's Copilot memory record WITHOUT creating a static dependency cycle
// (persistence ⇄ ai-copilot). The dynamic import is fire-and-forget and
// best-effort: a failure here must never affect the delete result.
// ---------------------------------------------------------------------------

export async function lazyCopilotMemoryCleanup(projectId: string): Promise<void> {
  try {
    const { getCopilotMemoryService } = await import(
      "./copilot-memory-service"
    );
    await getCopilotMemoryService().deleteForProject(projectId);
  } catch {
    // Best-effort — deleting a project must never depend on memory cleanup.
  }
}
