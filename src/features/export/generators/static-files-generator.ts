import type { OutputFile } from "../pipeline/types";

// ---------------------------------------------------------------------------
// Static file generator — produces boilerplate files for the exported project
//
// These files are the scaffolding that makes the exported project
// a valid, buildable Next.js + TypeScript + Tailwind application.
// ---------------------------------------------------------------------------

export function generatePackageJson(projectName: string): OutputFile {
  const name = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-") || "exported-project";
  const content = JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "next lint",
      },
      dependencies: {
        next: "^16.2.12",
        react: "^19.2.4",
        "react-dom": "^19.2.4",
      },
      devDependencies: {
        "@tailwindcss/postcss": "^4",
        "@types/node": "^20",
        "@types/react": "^19",
        "@types/react-dom": "^19",
        tailwindcss: "^4",
        typescript: "^5",
      },
    },
    null,
    2,
  );
  return { path: "package.json", content };
}

export function generateTsconfig(): OutputFile {
  const content = JSON.stringify(
    {
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2,
  );
  return { path: "tsconfig.json", content };
}

export function generateNextConfig(): OutputFile {
  const content = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
`;
  return { path: "next.config.ts", content };
}

export function generatePostcssConfig(): OutputFile {
  const content = `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`;
  return { path: "postcss.config.mjs", content };
}
