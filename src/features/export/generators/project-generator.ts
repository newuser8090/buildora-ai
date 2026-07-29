import type { Project } from "@/types/project";
import type { OutputFile } from "../pipeline/types";
import { sanitiseFolderName } from "../formatters/jsx-formatter";
import { generateGlobalsCss } from "./globals-css-generator";
import { generateLayout } from "./layout-generator";
import { generatePage } from "./page-generator";
import { generateAllSectionComponents } from "./section-generators/index";
import {
  generatePackageJson,
  generateTsconfig,
  generateNextConfig,
  generatePostcssConfig,
} from "./static-files-generator";

// ---------------------------------------------------------------------------
// Project generator — orchestrates all generators to produce the complete
// set of OutputFiles for a given Project.
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

    // Page — renders sections with serialized props
    generatePage(project),
  ];

  return { folderName, files };
}
