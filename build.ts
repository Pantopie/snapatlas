import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "fs";
import { minify as minifyHtml } from "html-minifier-terser";
import { createHash } from "crypto";

const ORDER = [
  "lib/nanoid",
  "dom",
  "state",
  "storage",
  "math",
  "packer",
  "seamless",
  "webgl",
  "ai",
  "analytics",
  "pipeline",
  "atlas-pipeline",
  "export",
  "ui/canvas",
  "ui/inspector",
  "ui/preview",
  "ui/export",
  "ui/modals",
  "ui/main",
  "onboarding",
];

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// ── Icons: minify standalone icons script ──
const iconsCode = readFileSync("js/lib/icons.js", "utf-8");
const minifiedIcons = new Bun.Transpiler({ loader: "js", minify: true } as any).transformSync(iconsCode);
const iconsFile = `icons.${hash(minifiedIcons)}.js`;
writeFileSync(`dist/${iconsFile}`, minifiedIcons);

// ── JS: concatenate in dependency order, then minify ──
const jsCode = ORDER.map((f) => readFileSync(`js/${f}.js`, "utf-8")).join("\n");
const minifiedJs = new Bun.Transpiler({ loader: "js", minify: true } as any).transformSync(jsCode);
const appJsFile = `app.${hash(minifiedJs)}.js`;
writeFileSync(`dist/${appJsFile}`, minifiedJs);

// ── CSS: minify via Bun.build into a temp name, then rename with hash ──
await Bun.build({
  entrypoints: ["./app.css"],
  outdir: "./dist",
  minify: true,
  naming: "[dir]/[name].[ext]",
});
const minifiedCss = readFileSync("dist/app.css", "utf-8");
const appCssFile = `app.${hash(minifiedCss)}.css`;
writeFileSync(`dist/${appCssFile}`, minifiedCss);
rmSync("dist/app.css");

// ── HTML: strip dev scripts, inject bundle, then full minify ──
let html = readFileSync("index.html", "utf-8");

html = html.replace(/<script\s+defer\s+src="[^"]+"[^>]*><\/script>\s*/g, "");
html = html.replace(/<link\s[^>]*rel="stylesheet"[^>]*>\s*/g, "");
// Umami analytics (production only) — see Technical notes in README.md
html = html.replace(
  "</head>",
  `  <link rel="stylesheet" href="${appCssFile}">\n  <script defer src="https://analytics.pantopie.studio/script.js" data-website-id="7211fa21-3376-4afb-bd41-16c3fded8c54"></script>\n</head>`,
);
html = html.replace(
  "</body>",
  `  <script defer src="${iconsFile}"></script>\n  <script defer src="${appJsFile}"></script>\n</body>`,
);

html = await minifyHtml(html, {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
  collapseBooleanAttributes: true,
  removeRedundantAttributes: true,
});

writeFileSync("dist/index.html", html);

copyFileSync("llms.txt", "dist/llms.txt");

// ── Assets: copy entire folder ──
mkdirSync("dist/assets", { recursive: true });
copyFileSync("assets/logo.svg", "dist/assets/logo.svg");
copyFileSync("assets/screenshot.jpeg", "dist/assets/screenshot.jpeg");

console.log("✓ dist/ built");
