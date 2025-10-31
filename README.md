<h1 align="center">DeltaScript</h1>
<p align="center">
  <img src="./logo.png" alt="DeltaScript Logo" width="160" />
</p>

<p align="center"><strong>DeltaScript (ds)</strong> — a modern, pragmatic typed superset that compiles to JavaScript, with a clean CLI and first‑class developer UX.</p>
<p align="center">
  VS Code Extension:
  <a href="https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode">Marketplace</a>
  ·
  <a href="https://open-vsx.org/extension/ztamdev/deltascript-vscode">Open VSX</a>
  </p>

<p align="center"><a href="./docs/index.md">Read the full documentation →</a></p>

---

## Overview

DeltaScript is a small language that compiles to JavaScript. It focuses on:
- Clear and readable syntax.
- Lightweight static types to catch mistakes early.
- Great CLI ergonomics for building, watching, and running single files.
- Friendly logging via SpectralLogs (optional, with shims and fallbacks).

You write `.ds` files and use the `dsc` CLI to transpile them into `.js` (ESM). The CLI also supports running a single `.ds` directly.

## Installation

You can install globally or locally.

- npm
  - Global: `npm i -g deltascript`
  - Project: `npm i -D deltascript`
- bun
  - Global: `bun add -g deltascript`
  - Project: `bun add -d deltascript`
- pnpm
  - Global: `pnpm add -g deltascript`
  - Project: `pnpm add -D deltascript`

After install, the `dsc` command will be available (globally or via npx/bunx/pnpx):

- `dsc --help`
- `npx dsc --help`
- `bunx dsc --help`

## Quick start

Initialize a project:

```
mkdir my-app && cd my-app
dsc init
# creates dsk.config.ds and ensures ./src exists
```

Add a file:

```
# ./src/main.ds
func Main() {
  spec.log("Hello from DeltaScript")
}
```

Build the project:

```
dsc build
```

Watch mode:

```
dsc dev
```

Run a single file directly:

```
dsc ./src/main.ds
```

When running a single file, `dsc` compiles to a temporary `.mjs` and executes it with Node for full interactivity.

## CLI commands

- `dsc init`
  - Creates `dsk.config.ds` (default config) and ensures `src/` exists.
- `dsc build [--no-builtins] [--migrate-to-spec] [--spectral-cdn]`
  - Transpile all `.ds` under `entry` into `.js` under `outDir`.
- `dsc dev [--no-builtins] [--migrate-to-spec] [--spectral-cdn]`
  - Watch mode with per-file debounce and concise logs.
- `dsc <file.ds> [args...] [--no-builtins] [--migrate-to-spec] [--spectral-cdn]`
  - Transpile a single `.ds` and execute it immediately using a temp `.mjs`.

### Flags

- `--no-builtins`
  - Disables SpectralLogs integration and the console.* tip.
- `--migrate-to-spec`
  - Rewrites `console.*` to `spec.*` in emitted JS for you.
- `--spectral-cdn`
  - Forces CDN imports for SpectralLogs instead of package imports/shim.

## Configuration (dsk.config.ds)

The configuration file is a JSON‑like object. Example:

```
{
  module: 'cjs',
  outDir: 'dist',
  entry: 'src',
  include: ['src'],
  exclude: ['node_modules'],
  builtins: true
}
```

- `entry`: root folder to search for `.ds` files.
- `outDir`: output folder for `.js` files.
- `include`/`exclude`: path filters.
- `builtins`: enables SpectralLogs integration and gentle tips.

## Language basics

See the full guide: [docs/language.md](./docs/language.md)

Highlights:

- Variables and types:
  ```
  let username::str = "Manuel"
  let score::num = 42
  let flags::arr<mbool> = [true, false, maybe]
  let obj::obj = { debug: true }
  ```

- Functions (`func` over `function`):
  ```
  func Greet(person::str) {
    spec.log("Hola " + person + "!")
  }
  ```

- Default parameters and type parsing:
  ```
  func Main(x::num = 3) {
    spec.log("types " + x)
  }
  ```

- Classes:
  ```
  class Counter {
    constructor(initial::num) {
      this.count::num = initial
    }
    increment() { this.count = this.count + 1 }
  }
  let c::Counter = new Counter(2)
  ```

- Control flow:
  ```
  let i::num = 0
  for (i = 0; i < 3; i = i + 1) {
    spec.log("Iteración for:", i)
  }

  let w::num = 0
  while (w < 2) {
    spec.log("Iteración while:", w)
    w = w + 1
  }

  let opt::str = "B"
  if (opt === "A") { spec.log("Option A") }
  else if (opt === "B") { spec.log("Option B") }
  else { spec.log("Default") }
  ```

- Interfaces (custom types):
  ```
  interface Person {
    name::str;
    age::num;
    tags::arr<str>;
    meta::obj;
  }

  func processPerson(p::Person) {
    spec.log("Procesando:", p.name)
    return p.name
  }

  let person::Person = { name: "Luisa", age: 21, tags: ["dev","student"], meta: {} }
  processPerson(person)
  ```

## SpectralLogs integration

DeltaScript provides optional SpectralLogs integration in three modes:

1) Package imports (preferred when available):
   - `import spec from 'spectrallogs'`
   - `import specweb from 'spectrallogs/web'`

2) CDN imports (force with `--spectral-cdn`):
   - `import spec from "https://esm.sh/spectrallogs"`
   - `import specweb from "https://esm.sh/spectrallogs/web"`

3) Shim fallback (no install, no CDN):
   - Defines `spec` (logging methods + async `input`) and an empty `specweb`.
   - No top‑level await is used; `input` uses `readline/promises` when available, or `window.prompt` in the browser.

Warnings and tips:
- A concise, yellow warning appears once if `console.*` is detected (shows filename).
- If many occurrences are detected, a tip suggests `--migrate-to-spec`.
- In `dev` the warning is shown once per session.

## Examples

See [./examples](./examples) for complete samples, including:
- Arrays and objects
- Functions and classes
- Control flow
- Interfaces and typed arrays
- Try/catch/finally
- Logging via `spec.*`

## Runtime and output

- Emitted JS is ESM. In project builds it writes `.js` to `outDir`.
- Single-file runs compile to a temporary `.mjs` and execute via Node, preserving interactivity (e.g., `await spec.input(...)`).
- Watch mode (`dsc dev`) recompiles changed files with debounce and concise output.

## License

MIT
