// ---------------------------------------------------------------------------
// Validate-props helper (Phase P22-A)
//
// Converts a Zod props schema into the ElementDefinition.validateProps shape
// so registry definitions stay plain data (no Zod import needed in the
// registry itself).
// ---------------------------------------------------------------------------

import type { z } from "zod";

export type ValidatePropsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: string[] };

export function schemaToValidateProps(
  schema: z.ZodType<Record<string, unknown>>,
): (props: unknown) => ValidatePropsResult {
  return (props: unknown) => {
    const result = schema.safeParse(props);
    if (result.success) {
      return { ok: true, value: result.data };
    }
    return {
      ok: false,
      issues: result.error.issues.map(
        (issue) =>
          `${issue.path.length > 0 ? issue.path.join(".") + ": " : ""}${issue.message}`,
      ),
    };
  };
}
