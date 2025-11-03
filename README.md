<h1 align="center">DeltaScript</h1>
 
<p align="center">
  <img src="./logo.png" alt="DeltaScript Logo" width="160" />
</p>

<p align="center">
  <em>A modern, pragmatic typed superset that compiles to JavaScript — with a clean CLI and first-class developer UX.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/deltascript">
    <img src="https://img.shields.io/npm/v/deltascript?color=%23CB3837&label=DeltaScript&logo=npm&logoColor=white&style=for-the-badge" alt="NPM Version" />
  </a>
  &nbsp;
  <a href="https://github.com/ZtaMDev/DeltaScript/blob/CrystalMain/LICENSE">
    <img src="https://img.shields.io/github/license/ZtaMDev/DeltaScript?style=for-the-badge&color=blue" alt="License" />
  </a>
</p>

<p align="center">
  <strong>VS Code Extension:</strong><br>
  <a href="https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode"><strong>Visual Studio Marketplace</strong></a>
  &nbsp;•&nbsp;
  <a href="https://open-vsx.org/extension/ztamdev/deltascript-vscode"><strong>Open VSX Registry</strong></a>
</p>

<p align="center">
  <strong>Docs:</strong><br>
  <a href="https://ztamdev.github.io/DeltaScript/"><strong>Read the full documentation →</strong></a>
</p>

## Overview

DeltaScript is a small language that compiles to JavaScript. It focuses on:
- Clear and readable syntax.
- Lightweight static types to catch mistakes early.
- Great CLI ergonomics for building, watching, and running single files.
- Friendly logging via SpectralLogs (optional, with shims and fallbacks).

You write `.ds` files and use the `dsc` CLI to transpile them into `.js` (ESM). The CLI also supports running a single `.ds` directly and can bundle dependencies for convenient execution.

## Installation

You can install globally or locally.

```bash
npm i -g deltascript
```
or
```bash
npm i deltascript
```

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

```ts
// ./src/main.ds
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
- `dsc build [--no-builtins] [--migrate-to-spec] [--minify] [--spectral-cdn]`
  - Transpile all `.ds` under `entry` into `.js` under `outDir`.
  - `--minify` will minify emitted JS (best‑effort via esbuild if available).
- `dsc dev [--no-builtins] [--migrate-to-spec] [--spectral-cdn]`
  - Watch mode with per-file debounce and concise logs.
- `dsc <file.ds> [args...] [--no-builtins] [--migrate-to-spec] [--spectral-cdn]`
  - Transpile a single `.ds` and execute it immediately using a temp `.mjs`.
  - When possible, the CLI bundles the entry for execution (includes imported `.js` and `.ds`).

### Flags

- `--no-builtins`
  - Disables SpectralLogs integration.

## Configuration (dsk.config.ds)

The configuration file is a JSON‑like object. Example:

```ts
export default {
  module: 'cjs',
  outDir: 'dist',
  entry: 'src',
  include: ['src'],
  exclude: ['node_modules'],
  builtins: true,
  minify: false
}
```

- `entry`: root folder to search for `.ds` files.
- `outDir`: output folder for `.js` files.
- `include`/`exclude`: path filters.
- `builtins`: enables SpectralLogs integration and gentle tips.
- `minify`: when true, builds are minified (same effect as `--minify`).

## Language basics

See the full guide: [Language Docs](https://ztamdev.github.io/DeltaScript/language)

Highlights:

- Variables and types:
  ```ts
  let username::str = "Manuel"
  let score::num = 42
  let flags::arr<mbool> = [true, false, maybe]
  let obj::obj = { debug: true }
  ```

- Functions (`func` over `function`):
  ```ts
  func Greet(person::str) {
    spec.log("Hola " + person + "!")
  }
  ```

- Function return types:
  ```ts
  func Sum(a::num, b::num)::num {
    return a + b
  }

  func Wrong()::num {
    return "x"      // error: Return type mismatch (expects num)
  }

  func NoReturn()::str {
    let x = 1
  }                  // error: declares return type str but has no return
  ```
  - Annotate after the parameter list with `::ReturnType`.
  - The compiler checks each `return` against the declared type and also reports missing returns.
  - Object literal returns for interface types are validated against required fields (shallow).

- Default parameters and type parsing:
  ```ts
  func Main(x::num = 3) {
    spec.log("types " + x)
  }
  ```

- Classes:
  ```ts 
  class Counter {
    constructor(initial::num) {
      this.count::num = initial
    }
    increment() { this.count = this.count + 1 }
    toString()::str { return "Counter(" + String(this.count) + ")" }
  }
  let c::Counter = new Counter(2)
  let s::str = c.toString() // class method return type is enforced
  ```

- Class/Function return types with `::ReturnType` are enforced:
  - Mismatched return expressions report diagnostics.
  - Missing `return` when a non-void is declared is reported.

- Control flow:
  ```ts
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

- Mutability controls (`mut` / `inmut`):
  ```ts
  let username::str = "Manuel"
  let score::num = 42
  
  mut score = 50         // explicit mutation assignment (allowed while variable is mutable)
  inmut username         // from this point on, username becomes immutable (const)
  
  // After inmut, further mutations are not allowed and `mut username = ...` will error.
  ```

- Interfaces (custom types):
  ```ts
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

### Interfaces – extended type checking

- Optional fields with `?`:
  ```ts
  interface Product {
    id::num;
    name::str;
    price::num;
    inStock::mbool;
    module?:: "esm" | "cjs"; // optional
  }
  ```
- Unions and string literals in field types are supported (e.g., `"esm" | "cjs" | str`).
- Per-field validation at declaration time ensures each provided property matches its field type.
- `mbool` accepts `true`, `false`, and `maybe` (treated as a boolean-like literal).
- Arrays with generics (e.g., `arr<str>`) are supported as before.
- Comments are ignored by validators (lines starting with `//` and blocks `/* ... */`).

Examples:
```ts
let ok1::Product = { id: 1, name: "Laptop", price: 999.99, inStock: true, module: "cjs" };
let ok2::Product = { id: 2, name: "Mouse", price: 29.99, inStock: maybe };
let bad1::Product = { id: 3, name: "Cable", price: "9.99", inStock: true }; // error: price expects num
let bad2::Product = { id: 4, name: "Hub", price: 19.99, inStock: true, module: "commonjs" }; // error: module expects "esm" | "cjs"
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

Notes:
- DeltaScript no longer emits automatic console usage warnings. If you want to migrate `console.*` to `spec.*`, use the `--migrate-to-spec` flag.

## Examples

See [Examples](https://ztamdev.github.io/DeltaScript/examples) for complete samples, including:
- Arrays and objects
- Functions and classes
- Control flow
- Interfaces and typed arrays
- Try/catch/finally
- Logging via `spec.*`

## Runtime and output

- Emitted JS is ESM. In project builds it writes `.js` to `outDir`.
- Single-file runs compile to a temporary `.mjs` and execute via Node, preserving interactivity (e.g., `await spec.input(...)`).
- Single-file runner attempts to bundle dependencies (both `.ds` and `.js`) for convenience using esbuild, when available.

### Importing JavaScript from DeltaScript

- You can import `.js` modules from `.ds` files. In project builds they are preserved.
- In single-file runs, the runner bundles imported `.js` along with transpiled `.ds` to a single executable module when possible.
- Watch mode (`dsc dev`) recompiles changed files with debounce and concise output.

## License

MIT

## Recommended: VS Code Extension

- Install the DeltaScript extension for best DX (syntax, LSP, completion, hover, go to definition):
  - [Marketplace](https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode)
  - [Open VSX](https://open-vsx.org/extension/ztamdev/deltascript-vscode)
- You can also search for “deltascript” directly inside VS Code in either the Marketplace or Open VSX (if using a compatible VS Code build).

What you get:

- Syntax highlighting: keywords, types, function and member calls, constants (`maybe/true/false`), and `::Type` annotations.
- Inline diagnostics backed by the DeltaScript transpiler:
  - Syntax errors and DeltaScript type errors with red squiggles and entries in the Problems panel.
  - Multiple diagnostics per file supported.
- Smarter completions: keywords (including async/await), types and constants, `spec.*` helpers, in-scope identifiers, and snippets.
- Hovers with code previews for symbol definitions and concise keyword/tooltips (mut, inmut, func, interface, spec.*).
- Navigation: go to definition, document/workspace symbols, references, rename, and signature help.

Tip: you can also search for “deltascript” directly inside VS Code.
