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

- npm:
  - `npm i -g deltascript`
  - `npm i -D deltascript`
- bun:
  - `bun add -g deltascript`
  - `bun add -d deltascript`
- pnpm:
  - `pnpm add -g deltascript`
  - `pnpm add -D deltascript`

### Initialize a project

```
dsc init
# creates dsk.config.ds and ensures ./src exists
```

### Build and watch

```
dsc build

dsc dev
```

### Run a single file

```
dsc ./src/main.ds
```

This compiles to a temporary `.mjs` and runs it via Node (interactive I/O supported).

## Next

- Read the Language Guide: [language.md](./language.md)
- Explore the CLI: [cli.md](./cli.md)
- Configure your project: [config.md](./config.md)
- Learn SpectralLogs integration: [spectrallogs.md](./spectrallogs.md)
