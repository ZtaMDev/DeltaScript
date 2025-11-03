---
layout: home
hero:
  name: DeltaScript
  text: Typed superset that compiles to JavaScript
  tagline: A modern, pragmatic language with a clean CLI and first‑class developer UX.
  image:
    src: /logo.png
    alt: DeltaScript logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Language Guide
      link: /language
    - theme: alt
      text: GitHub
      link: https://github.com/ZtaMDev/DeltaScript
    - theme: alt
      text: npm
      link: https://www.npmjs.com/package/deltascript
features:
  - icon: { src: /icons/ts.svg }
    title: Lightweight static types
    details: Catch mistakes early with readable annotations and interfaces.
  - icon: { src: /icons/plugin.svg }
    title: Clean CLI
    details: Build, watch, or run single files with a simple, intuitive CLI.
  - icon: { src: /icons/universal.svg }
    title: SpectralLogs (optional)
    details: Friendly logging with package, CDN, or shim modes and easy migration.
---

## Why DeltaScript

- Clear, readable syntax with lightweight `::Type` annotations.
- Great DX: simple CLI for init, build, dev, and single-file run.
- Optional SpectralLogs integration with package/CDN/shim modes.

## Install

### npm (global)

```bash
npm install -g deltascript
```
### npm (project)

```bash
npm install deltascript
```

## Quick Start

### 1) Initialize
```bash
dsc init
```

### 2) Create src/main.ds
```ts
func Main() {
  spec.log("Hello from DeltaScript")
}
```

### 3) Build or watch
```bash
dsc build
# or
dsc dev
```

### 4) Run a single file
```bash
dsc ./src/main.ds
```

## CLI (summary)

- `dsc init` — creates `dsk.config.ds` and ensures `src/` exists.
- `dsc build` — transpiles `.ds` to `.js` (ESM) into `outDir`.
  - `dsc dev` — watch mode with debounce and concise logs.
  - `dsc <file.ds>` — transpile and run a single file immediately (bundles deps when possible).

Useful flags: `--no-builtins`, `--migrate-to-spec`, `--spectral-cdn`, `--minify`.

### Highlights

- Class and function return types with `::ReturnType` are enforced (mismatches and missing returns reported).
- Single-file runner bundles imported `.ds` and `.js` when esbuild is available.

## Links

- Docs: [/getting-started](/getting-started)
- Language: [/language](/language)
- CLI: [/cli](/cli)
- Config: [/config](/config)
- Examples: [/examples](/examples)
- VS Code Extension: https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode