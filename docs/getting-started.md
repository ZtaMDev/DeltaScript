# DeltaScript Documentation

Welcome to the DeltaScript docs. Use the sidebar or the links below to navigate.

- Getting Started: install, init, build, dev, run
- Language Basics: syntax, types, functions, classes, control flow
- CLI Reference: commands and flags
- Configuration: dsk.config.ds options
- SpectralLogs Integration: logging, input, CDN vs package vs shim

## Getting Started

### Installation

Install globally or locally.

```bash
npm i -g deltascript
```

or

```bash
npm i deltascript
```

### Initialize a project

```bash
dsc init
```
creates dsk.config.ds and ensures ./src exists

### Build and watch

```bash
dsc build
```
or
```bash
dsc dev
```

### Run a single file

```bash
dsc ./src/main.ds
```

This compiles to a temporary `.mjs` and runs it via Node (interactive I/O supported).

## Next

- Read the Language Guide: [language.md](./language.md)
- Explore the CLI: [cli.md](./cli.md)
- Configure your project: [config.md](./config.md)
- Learn SpectralLogs integration: [spectrallogs.md](./spectrallogs.md)

## Recommended: VS Code Extension

- Install the DeltaScript extension for best DX (syntax, LSP, completion, hover, go to definition):
  - [Marketplace](https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode)
  - [Open VSX](https://open-vsx.org/extension/ztamdev/deltascript-vscode)
- You can also search for “deltascript” directly inside VS Code in either the Marketplace or Open VSX (if using a compatible VS Code build).
