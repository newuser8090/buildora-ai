import type { Project } from "@/types/project";
import type { OutputFile } from "../pipeline/types";
import { sanitiseFolderName } from "../formatters/jsx-formatter";
import { generateGlobalsCss } from "./globals-css-generator";
import { generateLayout } from "./layout-generator";
import { generatePageRoutes } from "./page-generator";
import { generateAllSectionComponents } from "./section-generators/index";
import {
  generatePackageJson,
  generateTsconfig,
  generateNextConfig,
  generatePostcssConfig,
} from "./static-files-generator";
import { buildExportAssetManifest, generateAssetFiles } from "./asset-export-manifest";

// ---------------------------------------------------------------------------
// Project generator — orchestrates all generators to produce the complete
// set of OutputFiles for a given Project.
//
// For projects with assets, an asset manifest is built and the public/assets/
// files are included. The manifest is passed to the page generator so section
// AssetRef fields are resolved to /assets/ public paths.
//
// The caller is responsible for validation before calling this function.
// ---------------------------------------------------------------------------

export interface GeneratedProject {
  /** Sanitised folder name for the ZIP root */
  folderName: string;
  /** All files to include in the export */
  files: OutputFile[];
}

export function generateExportProject(project: Project): GeneratedProject {
  const folderName = sanitiseFolderName(project.name);

  // Build asset manifest for referenced assets (if any)
  const assetManifest = buildExportAssetManifest(project);

  const files: OutputFile[] = [
    // Static boilerplate
    generatePackageJson(project.name),
    generateTsconfig(),
    generateNextConfig(),
    generatePostcssConfig(),

    // App layout and styling
    generateGlobalsCss(project.theme),
    generateLayout({ projectName: project.name }),

    // Section components — reusable templates
    ...generateAllSectionComponents(),

    // Page routes — one app/<slug>/page.tsx per page, with per-page metadata
    // and cross-page link resolution (pass manifest for asset resolution)
    ...generatePageRoutes(project, assetManifest.valid ? assetManifest : undefined),

    // Asset files — public/assets/ files for referenced assets
    ...(assetManifest.valid ? generateAssetFiles(assetManifest) : []),
  ];

  return { folderName, files };
}
