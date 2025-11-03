
# CLI Reference

The `dsc` CLI compiles, watches, and runs DeltaScript (`.ds`) files. All output JS is ESM.

## Commands

### dsc init
Creates a base configuration file and ensures the `src/` directory exists.

- Output: `dsk.config.ds` with sensible defaults and `builtins: true`.

### dsc build [flags]
Transpiles all `.ds` files from `entry` to `.js` files into `outDir`.

- Prints a concise summary of compiled files and any errors with code frames.
- Optional minification: pass `--minify` (best‑effort via esbuild if available).

### dsc dev [flags]

Watch mode that recompiles the touched `.ds` file with per‑file debounce.

- Prints a short “Recompiled &lt;file&gt;” line on success.

### dsc &lt;file.ds&gt; [args] [flags]
Transpiles a single file to a temporary `.mjs` and executes it with Node.

- Full interactive I/O (e.g., `await spec.input()` is supported).
- Ctrl+C forwards to the child process and cleans up temp files.
- When possible, the CLI bundles the entry (and its imported `.ds`/`.js`) into a single executable module using esbuild.

## Flags

- `--no-builtins`
  - Disables SpectralLogs integration.
  
- `--migrate-to-spec`
  - Rewrites console.* to spec.* in output.

- `--spectral-cdn`
  - Injects CDN imports for SpectralLogs.

- `--minify`
  - Minify emitted JS during `dsc build` (requires esbuild).


## Output and Errors

- Build output:
  - List of compiled files.
  - If any failures: red section with file:line:col and an inline code frame.

- Run (single file):
  - If the runtime throws, the CLI prints a red header with file:line:col and a code frame at the error location.

## Examples

- Initialize: `dsc init`
- Build: `dsc build`
- Build (minified): `dsc build --minify`
- Build and migrate console to spec: `dsc build --migrate-to-spec`
- Watch: `dsc dev`
- Run single file: `dsc ./src/main.ds`
- Run with CDN (browser‑first): `dsc ./src/main.ds --spectral-cdn`
- Run with no builtins: `dsc ./src/main.ds --no-builtins`
