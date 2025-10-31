# DeltaScript VS Code Extension

Language support for [DeltaScript](https://www.npmjs.com/package/deltascript): syntax highlighting, diagnostics via LSP, completions, hovers, go to definition, and a file icon for `.ds`.

## Features

- Syntax highlighting (TextMate grammar).
- Language configuration (comments, brackets, auto-closing pairs).
- LSP diagnostics powered by DeltaScript transpiler (`transpileSpark`).
- Completions:
  - Keywords (func, class, interface, control flow…).
  - Types (num, str, mbool, obj, arr).
  - `spec.*` helpers (log, error, warn, info, debug, success, input).
  - Snippets (function and class).
- Hover: symbol kind, basic type info and `maybe`.
- Go to Definition: within the current document (functions, classes, interfaces, variables).

## Requirements

- VS Code 1.84+
- Node.js 18+
- The extension bundles a simple LSP server and uses the `deltascript` transpiler for diagnostics. It looks first for the package, then falls back to the workspace `../../dist/transpiler.js` when developing alongside the language repo.

## Usage

- Open a `.ds` file.
- You will get colorization, diagnostics, completion, hover, and go-to-definition.

## License

MIT
