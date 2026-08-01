// ---------------------------------------------------------------------------
// validateProjectName — shared project name validation
// Used by both ProjectService and UI components to ensure consistent rules.
// ---------------------------------------------------------------------------

export const MAX_PROJECT_NAME_LENGTH = 80;

export interface ProjectNameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a project name. Returns { valid: true } or { valid: false, error }.
 *
 * Rules:
 * - Must be non-empty after trimming whitespace
 * - Must be 80 characters or fewer
 */
export function validateProjectName(name: string): ProjectNameValidationResult {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "Project name cannot be empty." };
  }

  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    return {
      valid: false,
      error: `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`,
    };
  }

  return { valid: true };
}

/**
 * Get the trimmed valid name, or throw on invalid.
 */
export function assertValidProjectName(name: string): string {
  const result = validateProjectName(name);
  if (!result.valid) throw new Error(result.error);
  return name.trim();
}
