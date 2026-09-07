import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo", ".git"]);
const rules = [
  { roots: ["apps/web"], forbidden: ["@repo/database", "apps/api", "../../apps/api", "../api"], reason: "The web app must use the typed API client and must never import persistence or API internals." },
  { roots: ["apps/worker"], forbidden: ["apps/api", "apps/web", "../../apps/api", "../../apps/web", "../api", "../web"], reason: "The worker may depend on shared packages/infrastructure but must not import another application entry point or its private modules." },
  { roots: ["packages/contracts", "packages/api-client", "packages/ui"], forbidden: ["@repo/database", "apps/api", "apps/web", "apps/worker"], reason: "Shared transport/UI packages must stay independent from database and application internals." },
  { roots: ["packages/database"], forbidden: ["apps/web", "apps/api", "apps/worker"], reason: "The database package is infrastructure and must not depend on application entry points." },
];

async function* walk(directory) {
  let entries;
  try { entries = await readdir(join(ROOT, directory), { withFileTypes: true }); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) yield child;
  }
}

function extractImports(source) {
  const imports = new Set();
  const patterns = [/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g, /import\s*\(\s*["']([^"']+)["']\s*\)/g, /require\s*\(\s*["']([^"']+)["']\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) if (match[1]) imports.add(match[1]);
  return [...imports];
}

const violations = [];
for (const rule of rules) {
  for (const root of rule.roots) {
    for await (const file of walk(root)) {
      const source = await readFile(join(ROOT, file), "utf8");
      for (const specifier of extractImports(source)) {
        if (rule.forbidden.some((entry) => specifier === entry || specifier.startsWith(`${entry}/`))) violations.push({ file, specifier, reason: rule.reason });
      }
    }
    const packagePath = join(ROOT, root, "package.json");
    try {
      const pkg = JSON.parse(await readFile(packagePath, "utf8"));
      const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      for (const forbidden of rule.forbidden.filter((entry) => entry.startsWith("@repo/"))) {
        if (declared[forbidden]) violations.push({ file: relative(ROOT, packagePath), specifier: forbidden, reason: rule.reason });
      }
    } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  }
}

if (violations.length) {
  console.error("Dependency-boundary violations detected:\n");
  for (const violation of violations) { console.error(`- ${violation.file}: ${violation.specifier}`); console.error(`  ${violation.reason}`); }
  process.exit(1);
}
console.log("Dependency-boundary check passed.");
