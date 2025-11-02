#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import chalk from "chalk";
import { fileURLToPath } from "url";
import { transpileFile, transpileSpark } from "./transpiler.js";
import { loadConfig } from "./config.js";
import { c } from "./utils/colors.js";
let _devWarnShown = false;
let _devSuggestShown = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0];

// Version flag: -v / --version
try {
  if (args.includes("-v") || args.includes("--version") || cmd === "-v" || cmd === "--version") {
    const pkgPath = path.join(__dirname, "..", "package.json");
    let v = "";
    try {
      const pkgRaw = fs.readFileSync(pkgPath, "utf8");
      const pkg = JSON.parse(pkgRaw);
      v = String(pkg?.version || "");
    } catch {}
    console.log(v ? `DeltaScript v${v}` : "DeltaScript");
    process.exit(0);
  }
} catch {}

// Single-file fast path: dsc file.ds [args]
let handled = false;
if (cmd && cmd.endsWith(".ds") && fs.existsSync(cmd)) {
  handled = true;
  const { flags, rest } = parseFlags(args.slice(1));
  runSingleFile(path.resolve(cmd), rest, flags);
}

if (!handled) switch (cmd) {
  case "init": {
    const configPath = path.join(process.cwd(), "dsk.config.ds");
    if (fs.existsSync(configPath)) {
      console.log(c.warn("⚠ dsk.config.ds already exists."));
      process.exit(0);
    }

    fs.writeFileSync(configPath, `export default {
  module: 'cjs',
  outDir: 'dist',
  entry: 'src',
  include: ['src'],
  exclude: ['node_modules'],
  builtins: true
}`, "utf8");

    console.log(c.success("dsk.config.ds created successfully."));
    // Ensure src directory exists
    const srcDir = path.join(process.cwd(), "src");
    if (!fs.existsSync(srcDir)) {
      fs.mkdirSync(srcDir, { recursive: true });
      console.log(c.info("Created src/ directory."));
    }
    break;
  }

  case "build":
  case "dev": {
    const config = loadConfig();
    const entryDir = path.resolve(config.entry || ".");
    const outDir = path.resolve(config.outDir || ".");
    const { flags } = parseFlags(args.slice(1));
    let files = getAllFiles(entryDir, [".ds"], config.exclude || []);
    // Always exclude the root config file if it falls under entryDir
    files = files.filter(f => path.basename(f) !== 'dsk.config.ds');

    console.log(c.title(`⚡ DeltaScript Compiler`));
    console.log(c.info(`Building ${files.length} .ds files...\n`));

    const compiled: { inPath: string; outPath: string }[] = [];
    const failed: { inPath: string; line?: number; column?: number; message: string }[] = [];
    let consoleFiles = 0;
    let consoleTotal = 0;
    for (const file of files) {
      const relative = path.relative(entryDir, file);
      const outputPath = path.join(outDir, relative.replace(/\.ds$/, ".js"));
      try {
        const src = fs.readFileSync(file, "utf8");
        const res = transpileSpark(src, file) as any;
        const js = typeof res === 'string' ? res : String(res?.code || '');
        const diags: Array<{ line: number; column: number; message: string }> = Array.isArray(res?.diagnostics) ? res.diagnostics : [];
        if (diags.length > 0) {
          for (const d of diags) {
            const l = Math.max(1, Number(d.line || 1));
            const ccol = Math.max(1, Number(d.column || 1));
            failed.push({ inPath: file, line: l, column: ccol, message: String(d.message || 'Error') });
          }
          continue;
        }
        // Flags and builtins resolution
        const cfg = config as any;
        const builtinsCfg = cfg?.builtins !== false;
        const builtins = flags.noBuiltins ? false : builtinsCfg;
        const migrate = !!flags.migrateToSpec;
        // SpectralLogs integration: auto-prepend imports when builtins or migrate
        if (builtins || migrate) {
          const injected = injectSpectralImports(js, !!flags.spectralCdn, process.cwd());
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, injected, "utf8");
        } else {
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, js, "utf8");
        }
        // Optional migration from console.* to spec.*
        if (migrate) {
          const cur = fs.readFileSync(outputPath, 'utf8');
          const rewritten = rewriteConsoleToSpec(cur);
          fs.writeFileSync(outputPath, rewritten, 'utf8');
        }
        compiled.push({ inPath: file, outPath: outputPath });
        const countCU = countConsoleUsage(src);
        if (countCU > 0) { consoleFiles++; consoleTotal += countCU; }
      } catch (err: any) {
        // Aggregate failure info for summary and print inline frame
        const e = err || {};
        const line = typeof e.line === 'number' ? e.line : undefined;
        const column = typeof e.column === 'number' ? e.column : undefined;
        const message = e.message ? String(e.message) : 'Unknown error';
        failed.push({ inPath: file, line, column, message });

        // Pretty per-error header and frame
        const l = line ?? 1; const ccol = column ?? 1;
        console.error("\n" + chalk.redBright.bold("✖ Error") + ' ' + chalk.bold(file) + ':' + chalk.yellow(String(l)) + ':' + chalk.yellow(String(ccol)));
        printCodeFrame(file, l, ccol);
        console.error(chalk.white(message) + "\n");
      }
    }

    // Summary output
    console.log(c.success(`✔ Compiled`), `${compiled.length} file(s):`);
    for (const item of compiled) {
      const relIn = path.relative(process.cwd(), item.inPath);
      const relOut = path.relative(process.cwd(), item.outPath);
      console.log("  ", c.gray("•"), relIn, c.gray("→"), relOut);
    }

    // Print detailed error frames after compiled list
    if (failed.length > 0) {
      for (const f of failed) {
        const l = Math.max(1, Number(f.line || 1));
        const ccol = Math.max(1, Number(f.column || 1));
        console.error("\n" + chalk.redBright.bold("✖ Error") + ' ' + chalk.bold(f.inPath) + ':' + chalk.yellow(String(l)) + ':' + chalk.yellow(String(ccol)));
        printCodeFrame(f.inPath, l, ccol);
        console.error(chalk.white(String(f.message || 'Error')) + "\n");
      }

      // Grouped failed summary
      // group by file to avoid duplicate entries when one file has multiple diagnostics
      const byFile = new Map<string, number>();
      for (const f of failed) {
        byFile.set(f.inPath, (byFile.get(f.inPath) || 0) + 1);
      }
      const files = Array.from(byFile.keys());
      console.log("\n" + c.error(`✖ Failed`), `${files.length} file(s):`);
      for (const p of files) {
        const rel = path.relative(process.cwd(), p);
        const n = byFile.get(p) || 1;
        const suffix = n > 1 ? ` (${n} errors)` : "";
        console.log("  ", c.gray("•"), rel + suffix);
      }
      process.exitCode = 1;
    }

    // removed console usage tips/warnings

    if (cmd === "dev") watch(entryDir, outDir, config);
    break;
  }

  default: {
    console.log(c.bold("DeltaScript CLI"));
    console.log(c.gray("Flags:"));
    console.log("    --no-builtins          → disable auto imports and console tip (overrides config)");
    console.log("    --migrate-to-spec      → rewrite console.* calls to spec.* during compilation");
    console.log("    --spectral-cdn         → inject CDN imports (esm.sh) instead of node package imports");
    console.log("    -v, --version          → print DeltaScript version");
    console.log("  dsc init                 → create base configuration (dsk.config.ds)");
    console.log("  dsc build                → compile all .ds files");
    console.log("  dsc dev                  → watch mode (development)");
    console.log("  dsc <file.ds> [args...]  → transpile and run a .ds file immediately");
  }
}

// ---------------------------------
// Helpers
// ---------------------------------
function getAllFiles(dir: string, exts: string[] | string, exclude: string[]): string[] {
  const result: string[] = [];
  const arr = Array.isArray(exts) ? exts : [exts];
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (exclude.some(e => full.includes(e))) continue;

    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      result.push(...getAllFiles(full, arr, exclude));
    } else if (arr.some(ext => file.endsWith(ext))) {
      result.push(full);
    }
  }
  return result;
}

function watch(entry: string, out: string, config: any) {
  console.log(c.info("\n👀 Watching for changes..."));
  const timers = new Map<string, NodeJS.Timeout>();

  fs.watch(entry, { recursive: true }, (evt, filename) => {
    if (!filename || !filename.endsWith(".ds")) return;
    if (path.basename(filename) === 'dsk.config.ds') return;
    const inPath = path.join(entry, filename);
    const outPath = path.join(out, filename.replace(/\.ds$/, ".js"));
    if (timers.has(inPath)) clearTimeout(timers.get(inPath)!);
    const t = setTimeout(() => {
      timers.delete(inPath);
      try {
        transpileFile(inPath, outPath);
        console.log(c.success(`Recompiled `) + filename);
      } catch (err: any) {
        console.error(c.error(`Error compiling `) + filename + ": " + err.message);
      }
    }, 120);
    timers.set(inPath, t);
  });
}

function runSingleFile(inFile: string, args: string[], flags: { noBuiltins?: boolean; migrateToSpec?: boolean; spectralCdn?: boolean } = {}) {
  // Load config only if it exists to avoid noisy warning in single-file mode
  const cfgPath = path.join(process.cwd(), "dsk.config.ds");
  const hasConfig = fs.existsSync(cfgPath);
  const config: any = hasConfig ? loadConfig() : {};
  const src = fs.readFileSync(inFile, "utf8");
  try {
    // Build a temporary workspace and transpile the entry and its .ds dependencies recursively
    let outJsPath: string;
    let tempDir: string | null = null;
    const entryDir = path.dirname(inFile);
    // Entry-level flags
    const builtinsCfg = (config as any)?.builtins !== false;
    const builtinsEntry = flags.noBuiltins ? false : builtinsCfg;
    const migrateEntry = !!flags.migrateToSpec;
    const graph = resolveDsDependencyGraph(inFile);
    // Create temp dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deltascript-run-"));
    // Mark temp workspace as ESM to avoid Node warnings for .js with import/export
    try {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    } catch {}
    // Transpile all .ds in graph into temp dir preserving relative structure to entryDir
    for (const absPath of graph) {
      const rel = path.relative(entryDir, absPath);
      const outPath = path.join(tempDir, rel.replace(/\.ds$/, ".js"));
      const code = fs.readFileSync(absPath, "utf8");
      const res = transpileSpark(code, absPath) as any;
      const jsFileBase = typeof res === 'string' ? res : String(res?.code || '');
      const diags: Array<{ line: number; column: number; message: string }> = Array.isArray(res?.diagnostics) ? res.diagnostics : [];
      if (diags.length > 0) {
        for (const d of diags) {
          const l = Math.max(1, Number(d.line || 1));
          const ccol = Math.max(1, Number(d.column || 1));
          console.error("\n" + chalk.redBright.bold("✖ Error") + ' ' + chalk.bold(absPath) + ':' + chalk.yellow(String(l)) + ':' + chalk.yellow(String(ccol)));
          printCodeFrame(absPath, l, ccol);
          console.error(chalk.white(String(d.message || 'Error')) + "\n");
        }
        throw new Error('Compilation failed');
      }
      let jsFile = jsFileBase;
      // Inject builtins into every module so spec is available cross-module
      if (builtinsEntry || migrateEntry) {
        jsFile = injectSpectralImports(jsFile, !!flags.spectralCdn, process.cwd());
      }
      // Only rewrite console->spec for entry file to avoid surprises
      if (absPath === inFile && migrateEntry) jsFile = rewriteConsoleToSpec(jsFile);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, jsFile, "utf8");
    }
    // Entry is executed as .mjs to allow top-level await; re-write extension for entry
    const entryRel = path.relative(entryDir, inFile).replace(/\.ds$/, ".mjs");
    outJsPath = path.join(tempDir, entryRel);
    // Ensure .mjs exists by copying .js sibling
    const entryJsPath = outJsPath.replace(/\.mjs$/, ".js");
    try { fs.copyFileSync(entryJsPath, outJsPath); } catch {}

    const child = spawn(process.execPath, [outJsPath, ...args], { stdio: "inherit", cwd: tempDir || process.cwd() });

    let exiting = false;
    const onExit = (code?: number | null) => {
      // Cleanup temp artifacts if used
      if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
      process.exit(code ?? 0);
    };

    child.on("exit", (code) => onExit(code));
    child.on("error", (err) => {
      console.error(c.error("Failed to start child process: ") + String(err.message || err));
      onExit(1);
    });

    const handleSigint = () => {
      if (exiting) return;
      exiting = true;
      console.log(chalk.gray("exiting process"));
      try { child.kill("SIGINT"); } catch {}
    };
    process.once("SIGINT", handleSigint);
    process.once("SIGTERM", handleSigint);
    // removed single-file console usage warnings/tips
  } catch (err: any) {
    const line = typeof err?.line === 'number' ? err.line : 1;
    const col = typeof err?.column === 'number' ? err.column : 1;
    console.error("\n" + chalk.redBright.bold("✖ Error") + ' ' + chalk.bold(inFile) + ':' + chalk.yellow(String(line)) + ':' + chalk.yellow(String(col)));
    printCodeFrame(inFile, line, col);
    console.error(chalk.redBright(err?.message || 'Unknown error') + "\n");
    process.exit(1);
  }
}

// Helper to transpile without writing
function transpileFileToString(src: string, filePath: string): string {
  const res = transpileSpark(src, filePath) as any;
  return typeof res === 'string' ? res : String(res?.code || '');
}

// Pretty code frame helper
function printCodeFrame(filePath: string, line: number, column: number) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const idx = Math.max(1, Math.min(line || 1, lines.length));
    const start = Math.max(1, idx - 2);
    const end = Math.min(lines.length, idx + 2);
    for (let i = start; i <= end; i++) {
      const ln = lines[i - 1] ?? "";
      const marker = i === idx ? chalk.redBright('>') : ' ';
      console.error(`${marker} ${chalk.gray(String(i).padStart(4, ' '))} ${chalk.gray('|')} ${highlightLine(ln)}`);
      if (i === idx) {
        const caretPos = Math.max(1, column || 1);
        const pad = ' '.repeat(caretPos - 1);
        console.error(`  ${chalk.gray(''.padStart(4, ' '))} ${chalk.gray('|')} ${pad}${chalk.redBright('^')}`);
      }
    }
  } catch {
    // ignore frame errors
  }
}

function highlightLine(s: string): string {
  return s
    .replace(/(\/\/.*$)/, (_m) => chalk.gray(_m))
    .replace(/(['"][^'"\\]*(?:\\.[^'"\\]*)*['"])/g, (_m) => chalk.green(_m))
    .replace(/\b(\d+(?:\.\d+)?)\b/g, (_m) => chalk.yellow(_m))
    .replace(/\b(function|return|if|else|for|while|try|catch|finally|class|let|const|var|new|throw)\b/g, (_m) => chalk.cyanBright(_m));
}

// Detect console usage in source
function hasConsoleUsage(src: string): boolean {
  return /\bconsole\.(log|error|warn|info|debug)\b/.test(src);
}

// Build a dependency graph of .ds files starting from entry
function resolveDsDependencyGraph(entryAbs: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (absPath: string) => {
    const real = path.resolve(absPath);
    if (seen.has(real)) return;
    seen.add(real);
    let content = '';
    try { content = fs.readFileSync(real, 'utf8'); } catch { return; }
    const dir = path.dirname(real);
    // import ... from "...ds" | export ... from "...ds"
    const re = /\b(?:import|export)\b[\s\S]*?\bfrom\b\s*['"]([^'"]+\.ds)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const spec = m[1];
      const child = path.resolve(dir, spec);
      visit(child);
    }
    order.push(real);
  };
  visit(entryAbs);
  return order;
}

function countConsoleUsage(src: string): number {
  const re = /\bconsole\.(log|error|warn|info|debug)\b/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(src)) !== null) n++;
  return n;
}

// Inject SpectralLogs integration: default is an auto shim that works in Node and Browser.
// If useCdn is true, inject static CDN imports instead.
function injectSpectralImports(js: string, useCdn = false, projectRoot: string = process.cwd()): string {
  const hasExisting = /import\s+.*from\s+['\"]https:\/\/esm\.sh\/spectrallogs/.test(js)
    || /import\s+.*from\s+['\"]spectrallogs/.test(js)
    || /const\s+spec\s*=\s*\(\(\)\s*=>/.test(js);
  if (hasExisting) return js;

  if (useCdn) {
    const cdn1 = "import spec from \"https://esm.sh/spectrallogs\"";
    const cdn2 = "import specweb from \"https://esm.sh/spectrallogs/web\"";
    return `${cdn1}\n${cdn2}\n${js}`;
  }

  // If package exists, prefer static package imports (no TLA)
  try {
    const pkgPath = path.join(projectRoot, 'node_modules', 'spectrallogs', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg1 = "import spec from 'spectrallogs'";
      const pkg2 = "import specweb from 'spectrallogs/web'";
      return `${pkg1}\n${pkg2}\n${js}`;
    }
  } catch {}

  // Fallback: synchronous shim without top-level await
  const shim = `const spec = (() => {\n`
    + `  const mk = (lvl) => (...a) => (console[lvl] ? console[lvl](...a) : console.log(...a));\n`
    + `  const input = async (q) => {\n`
    + `    if (typeof window !== 'undefined' && typeof window.prompt === 'function') { return window.prompt(q) ?? ''; }\n`
    + `    try { const rl = await import('node:readline/promises'); const { stdin, stdout } = await import('node:process');\n`
    + `      const r = rl.createInterface({ input: stdin, output: stdout }); const ans = await r.question(q + ' '); r.close(); return ans; } catch { return ''; }\n`
    + `  };\n`
    + `  return { log: mk('log'), error: mk('error'), warn: mk('warn'), info: mk('info'), debug: mk('debug'), success: (...a) => console.log(...a), input };\n`
    + `})();`;
  return `${shim}\n${js}`;
}

// Rewrite console.* to spec.*
function rewriteConsoleToSpec(js: string): string {
  return js
    .replace(/\bconsole\.log\s*\(/g, 'spec.log(')
    .replace(/\bconsole\.error\s*\(/g, 'spec.error(')
    .replace(/\bconsole\.warn\s*\(/g, 'spec.warn(')
    .replace(/\bconsole\.info\s*\(/g, 'spec.info(')
    .replace(/\bconsole\.debug\s*\(/g, 'spec.debug(');
}

function parseFlags(arr: string[]): { flags: { noBuiltins?: boolean; migrateToSpec?: boolean; spectralCdn?: boolean }, rest: string[] } {
  const flags: { noBuiltins?: boolean; migrateToSpec?: boolean; spectralCdn?: boolean } = {};
  const rest: string[] = [];
  for (const a of arr) {
    if (a === '--no-builtins') { flags.noBuiltins = true; continue; }
    if (a === '--migrate-to-spec' || a === '-migrate-to-spec') { flags.migrateToSpec = true; continue; }
    if (a === '--spectral-cdn') { flags.spectralCdn = true; continue; }
    rest.push(a);
  }
  return { flags, rest };
}
