import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Asset components render user-uploaded assets with <img> rather than
  // next/image because the source is a local data URL or blob URL, not an
  // optimized remote image. next/image is used elsewhere for static/public
  // images.
  {
    files: [
      "src/features/assets/components/ResolvedAssetImage.tsx",
      "src/features/assets/components/AssetPicker.tsx",
      "src/features/assets/components/AssetThumbnail.tsx",
      "src/features/assets/components/InspectorAssetField.tsx",
      // ProjectCard renders runtime object URLs (blob:) produced from
      // IndexedDB thumbnail Blobs — never optimized remote images.
      "src/features/projects/components/ProjectCard.tsx",
      // My Blocks card + drag overlay render runtime object URLs (blob:)
      // produced from the My Blocks thumbnail Blob store — same policy.
      "src/features/my-blocks/components/MyBlockThumb.tsx",
      "src/features/my-blocks/drag/MyBlockDndProvider.tsx",
    ],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  // The codebase marks intentionally-unused parameters in stubs/mocks with an
  // underscore prefix (e.g. `_req`, `_name`, `_type`). Honor that convention so
  // these do not surface as false-positive unused-var warnings.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
