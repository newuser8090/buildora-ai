// ---------------------------------------------------------------------------
// Node converter tests (Phase P2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import { validateTree } from "../../../blocks/engine/nesting-rules";
import type { BlockNode, BlockTree } from "../../../blocks/types";
import { analyseImportSource } from "../../analysis/analyse-import-source";
import { convertImportNodes } from "../node-converter";
import { createConversionContext } from "../conversion-report";
import { conversionIdFactory } from "./test-utils";

interface ConvertedFixture {
  tree: BlockTree;
  warnings: string[];
}

/** Convert raw HTML through P1 analysis → node conversion (no orchestration). */
function convertHtml(source: string): ConvertedFixture {
  const analysis = analyseImportSource(source);
  const context = createConversionContext(analysis, conversionIdFactory("b"));
  const blocks = convertImportNodes(analysis.rootNodes, context);
  const roots = blocks.filter((block) => block.parentId === null);

  const tree: BlockTree = {
    rootIds: roots.map((r) => r.id),
    nodes: Object.fromEntries(blocks.map((block) => [block.id, block])),
  };

  return {
    tree,
    warnings: context.report
      .finalize(analysis.detectedLanguage, blocks.length, roots.length, {})
      .warnings.map((w) => w.code),
  };
}

function rootsOf(tree: BlockTree): BlockNode[] {
  return tree.rootIds.map((id) => tree.nodes[id]);
}

function flatten(tree: BlockTree): BlockNode[] {
  const result: BlockNode[] = [];
  const visit = (node: BlockNode): void => {
    result.push(node);
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) visit(child);
    }
  };
  for (const root of rootsOf(tree)) visit(root);
  return result;
}

describe("layout conversion", () => {
  it("converts a flex row into a row block with two columns", () => {
    const { tree } = convertHtml(
      '<div class="flex gap-4"><div class="flex-1"><h2>One</h2></div><div class="flex-1"><p>Two</p></div></div>',
    );
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("row");
    expect(root.props.layoutDirection).toBe("row");
    expect(root.props.gap).toBe(16);
    expect(root.children.length).toBe(2);
    const cols = root.children.map((id) => tree.nodes[id]);
    expect(cols.map((c) => c.type)).toEqual(["container", "container"]);
    expect(cols[0].children.map((id) => tree.nodes[id].type)).toEqual(["heading"]);
  });

  it("downgrades a row whose children would violate nesting rules", () => {
    const { tree, warnings } = convertHtml('<div class="flex"><h2>Title</h2><p>Body</p></div>');
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("container");
    expect(root.style.display).toBe("flex");
    expect(warnings).toContain("nesting-downgrade");
    expect(root.children.map((id) => tree.nodes[id].type)).toEqual(["heading", "paragraph"]);
  });

  it("converts a grid into a grid block with cards", () => {
    const { tree } = convertHtml(
      '<div class="grid grid-cols-3 gap-6">' +
        '<div class="card"><h3>One</h3><p>Desc</p></div>' +
        '<div class="card"><h3>Two</h3><p>Desc</p></div>' +
        "</div>",
    );
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("grid");
    expect(root.props.columns).toBe(3);
    expect(root.children.map((id) => tree.nodes[id].type)).toEqual(["card", "card"]);
  });
});

describe("text conversion", () => {
  it("turns short typography-styled text into a heading", () => {
    const { tree } = convertHtml('<div class="text-3xl font-bold">Welcome to Acme</div>');
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("heading");
    expect(root.props.text).toBe("Welcome to Acme");
    expect(root.style.fontSize).toBe("1.875rem");
  });

  it("turns long text into a paragraph", () => {
    const { tree } = convertHtml(
      "<div>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</div>",
    );
    expect(rootsOf(tree)[0].type).toBe("paragraph");
  });

  it("keeps heading levels from tags", () => {
    const { tree } = convertHtml("<h1>Title</h1>");
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("heading");
    expect(root.props.level).toBe(1);
  });
});

describe("forms and controls", () => {
  it("converts a form and folds labels into their controls", () => {
    const { tree } = convertHtml(
      '<form><label>Email</label><input type="email" placeholder="you@example.com"><button>Send</button></form>',
    );
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("form");
    expect(root.props.name).toBe("Form");
    const children = root.children.map((id) => tree.nodes[id]);
    expect(children.map((c) => c.type)).toEqual(["input", "button"]);
    expect(children[0].props.label).toBe("Email");
    expect(children[0].props.placeholder).toBe("you@example.com");
  });

  it("maps radio and select with approximation warnings", () => {
    const { tree, warnings } = convertHtml('<form><input type="radio" name="plan"><select></select></form>');
    expect(validateTree(tree).valid).toBe(true);
    expect(warnings).toContain("mapping-approximation");
    const types = flatten(tree).map((n) => n.type);
    expect(types).toContain("checkbox");
    expect(types).toContain("input");
  });
});

describe("navigation and lists", () => {
  it("converts a nav with links into a menu block", () => {
    const { tree } = convertHtml('<nav><a href="/">Home</a><a href="/about">About</a></nav>');
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("menu");
    expect(root.props.links).toEqual([
      { text: "Home", href: "/" },
      { text: "About", href: "/about" },
    ]);
    expect(validateTree(tree).valid).toBe(true);
  });

  it("converts an unordered list of plain items into a stack of paragraphs", () => {
    const { tree } = convertHtml("<ul><li>First</li><li>Second</li></ul>");
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("stack");
    expect(root.children.map((id) => tree.nodes[id].type)).toEqual(["paragraph", "paragraph"]);
    expect(validateTree(tree).valid).toBe(true);
  });

  it("persists unconverted classes as importClasses on blocks", () => {
    const { tree } = convertHtml('<div class="hero-card flex"><p>Body</p></div>');
    const root = rootsOf(tree)[0];
    expect(root.props.importClasses).toContain("hero-card");
    expect(root.props.importClasses).not.toContain("flex");
  });

  it("converts a list of links into a menu", () => {
    const { tree } = convertHtml("<ul><li><a href=\"/a\">A</a></li><li><a href=\"/b\">B</a></li></ul>");
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("menu");
    expect(root.props.links).toHaveLength(2);
    expect(validateTree(tree).valid).toBe(true);
  });

  it("folds header brand text into the navbar logoText", () => {
    const { tree } = convertHtml(
      '<header class="flex items-center gap-4"><span class="font-bold">Acme</span><nav><a href="/">Home</a></nav><button>Sign in</button></header>',
    );
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("navbar");
    expect(root.props.logoText).toBe("Acme");
    expect(root.children.map((id) => tree.nodes[id].type)).toEqual(["menu", "button"]);
  });

  it("downgrades a header with a logo image to a container", () => {
    const { tree, warnings } = convertHtml(
      '<header class="flex items-center justify-between"><img class="logo" src="/logo.png" alt="Acme"><nav><a href="/">Home</a></nav><button>Sign up</button></header>',
    );
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("container");
    expect(warnings).toContain("nesting-downgrade");
    expect(root.children.map((id) => tree.nodes[id].type)).toEqual(["image", "menu", "button"]);
  });

  it("converts a footer with text and links", () => {
    const { tree } = convertHtml(
      '<footer><p>© 2026 Acme</p><ul><li><a href="/privacy">Privacy</a></li></ul></footer>',
    );
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("footer");
    expect(root.children.map((id) => tree.nodes[id].type)).toEqual(["paragraph", "menu"]);
  });
});

describe("composite blocks", () => {
  it("converts a pricing card and extracts its props", () => {
    const { tree } = convertHtml(
      '<div class="pricing-card"><h3>Pro</h3><p>$29</p><p>per month</p><button>Choose</button></div>',
    );
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("pricing-card");
    expect(root.props.price).toBe("$29");
    expect(root.props.period).toBe("per month");
    expect(root.props.name).toBe("Pro");
    expect(validateTree(tree).valid).toBe(true);
  });

  it("downgrades an accordion with non-nestable children", () => {
    const { tree, warnings } = convertHtml(
      '<div class="accordion"><div class="item"><button>Q</button><p>A</p></div></div>',
    );
    expect(validateTree(tree).valid).toBe(true);
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("container");
    expect(warnings).toContain("nesting-downgrade");
  });

  it("detects hero sections and names them", () => {
    const { tree } = convertHtml(
      '<section class="hero py-20"><div class="hero-content"><h1>Build faster</h1><p>Sub</p></div></section>',
    );
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("container");
    expect(root.props.name).toBe("Hero");
    expect(validateTree(tree).valid).toBe(true);
  });
});

describe("leaf blocks", () => {
  it("flattens a button icon into text with a warning", () => {
    const { tree, warnings } = convertHtml(
      '<button><img src="/icon.png" alt=""><span>Download</span></button>',
    );
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("button");
    expect(root.props.text).toBe("Download");
    expect(warnings).toContain("nested-element-flattened");
  });

  it("converts svg to an icon placeholder", () => {
    const { tree, warnings } = convertHtml('<svg class="w-6 h-6"><path d="M0 0"></path></svg>');
    const root = rootsOf(tree)[0];
    expect(root.type).toBe("icon");
    expect(root.props.size).toBe(24);
    expect(warnings).toContain("mapping-approximation");
  });

  it("converts empty height divs into spacers", () => {
    const { tree } = convertHtml('<div class="h-16"></div>');
    expect(rootsOf(tree)[0].type).toBe("spacer");
  });
});

describe("multi-root and fragments", () => {
  it("keeps multiple roots as separate sections", () => {
    const { tree } = convertHtml("<h1>One</h1><p>Two</p>");
    expect(rootsOf(tree).map((r) => r.type)).toEqual(["heading", "paragraph"]);
    expect(validateTree(tree).valid).toBe(true);
  });
});

describe("determinism", () => {
  it("produces identical trees for identical input", () => {
    const source = '<section class="hero"><h1>Hi</h1><a class="btn" href="/x">Go</a></section>';
    const a = convertHtml(source);
    const b = convertHtml(source);
    expect(JSON.stringify(a.tree)).toBe(JSON.stringify(b.tree));
  });
});
