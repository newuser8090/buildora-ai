// ---------------------------------------------------------------------------
// validateProjectName tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { validateProjectName, MAX_PROJECT_NAME_LENGTH } from "../utils/validate-project-name";

describe("validateProjectName", () => {
  it("validates a normal name", () => {
    const result = validateProjectName("My Project");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects empty strings", () => {
    const result = validateProjectName("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Project name cannot be empty.");
  });

  it("rejects whitespace-only strings", () => {
    const result = validateProjectName("   ");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Project name cannot be empty.");
  });

  it("rejects names over 80 characters", () => {
    const longName = "a".repeat(MAX_PROJECT_NAME_LENGTH + 1);
    const result = validateProjectName(longName);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("80 characters");
  });

  it("accepts names at exactly 80 characters", () => {
    const name = "a".repeat(MAX_PROJECT_NAME_LENGTH);
    const result = validateProjectName(name);
    expect(result.valid).toBe(true);
  });
});
