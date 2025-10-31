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

    fs.writeFileSync(configPath, `{
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
    const files = getAllFiles(entryDir, [".ds"], config.exclude || []);

    console.log(c.title(`⚡ DeltaScript Compiler`));
    console.log(c.info(`Building ${files.length} .ds files...\n`));

    const compiled: { inPath: string; outPath: string }[] = [];
    const failed: { inPath: string; line?: number; column?: number; message: string }[] = [];
    let printedConsoleTip = false;
    let consoleFiles = 0;
    let consoleTotal = 0;
    for (const file of files) {
      const relative = path.relative(entryDir, file);
      const outputPath = path.join(outDir, relative.replace(/\.ds$/, ".js"));
      try {
        const src = fs.readFileSync(file, "utf8");
        let js = transpileSpark(src, file);
        // Flags and builtins resolution
        const cfg = config as any;
        const builtinsCfg = cfg?.builtins !== false;
        const builtins = flags.noBuiltins ? false : builtinsCfg;
        const migrate = !!flags.migrateToSpec;
        // SpectralLogs integration: auto-prepend imports when builtins or migrate
        if (builtins || migrate) {
          js = injectSpectralImports(js, !!flags.spectralCdn, process.cwd());
        }
        // Optional migration from console.* to spec.*
        if (migrate) {
          js = rewriteConsoleToSpec(js);
        }
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, js, "utf8");
        compiled.push({ inPath: file, outPath: outputPath });
        const countCU = countConsoleUsage(src);
        if (countCU > 0) { consoleFiles++; consoleTotal += countCU; }
        if (builtins && !migrate && !printedConsoleTip && countCU > 0) {
          if (cmd === "dev" && _devWarnShown) {
            // skip extra warnings in dev after first
          } else {
            printedConsoleTip = true; _devWarnShown = true;
            const rel = path.relative(process.cwd(), file);
            console.log(chalk.yellow(`(warning) ${rel}: uses console.* → prefer spec.log/spec.error/etc.`));
          }
        }
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

    if (failed.length > 0) {
      console.log("\n" + c.error(`✖ Failed`), `${failed.length} file(s):`);
      for (const f of failed) {
        const rel = path.relative(process.cwd(), f.inPath);
        const lc = (f.line != null && f.column != null) ? `:${f.line}:${f.column}` : '';
        console.log("  ", c.gray("•"), rel + lc, "-", f.message);
      }
      process.exitCode = 1;
    }

    if ((consoleFiles >= 3 || consoleTotal >= 5) && cmd !== "dev") {
      console.log(chalk.yellow(`(tip) frequent console.* detected across files → try --migrate-to-spec to rewrite automatically`));
    } else if (cmd === "dev" && (consoleFiles >= 3 || consoleTotal >= 5) && !_devSuggestShown) {
      _devSuggestShown = true;
      console.log(chalk.yellow(`(tip) frequent console.* detected → try --migrate-to-spec`));
    }

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
    let js = transpileFileToString(src, inFile);
    let outJsPath: string;
    let tempDir: string | null = null;
    // SpectralLogs integration in single-file run
    const builtinsCfg = (config as any)?.builtins !== false;
    const builtins = flags.noBuiltins ? false : builtinsCfg;
    const migrate = !!flags.migrateToSpec;
    // Inject SpectralLogs (shim or CDN) and optional migration
    if (builtins || migrate) {
      js = injectSpectralImports(js, !!flags.spectralCdn, process.cwd());
    }
    if (migrate) {
      js = rewriteConsoleToSpec(js);
    }
    // Always run from a temporary .mjs to guarantee ESM and top-level await
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dawnscript-"));
    outJsPath = path.join(tempDir, path.basename(inFile).replace(/\.ds$/, ".mjs"));
    fs.writeFileSync(outJsPath, js, "utf8");

    const child = spawn(process.execPath, [outJsPath, ...args], { stdio: "inherit" });

    let exiting = false;
    const onExit = (code?: number | null) => {
      // Cleanup temp artifacts if used
      if (tempDir) {
        try { fs.unlinkSync(outJsPath); } catch {}
        try { fs.rmdirSync(tempDir); } catch {}
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
    const occ = countConsoleUsage(src);
    if (builtins && !migrate && occ > 0) {
      if (!_devWarnShown) {
        _devWarnShown = true;
        const rel = path.relative(process.cwd(), inFile);
        console.log(chalk.yellow(`(warning) ${rel}: uses console.* → prefer spec.log/spec.error/etc.`));
      }
      if (occ >= 3 && !_devSuggestShown) {
        _devSuggestShown = true;
        console.log(chalk.yellow(`(tip) frequent console.* in this file → run with --migrate-to-spec`));
      }
    }
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
  return transpileSpark(src, filePath);
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
  const shimWeb = `const specweb = {};`;
  return `${shim}\n${shimWeb}\n${js}`;
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
