# DeltaScript VS Code Extension

[![Version](https://img.shields.io/visual-studio-marketplace/v/ZtaMDev.deltascript-vscode?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/ZtaMDev.deltascript-vscode?style=for-the-badge)](https://marketplace.visualstudio.com/items?itemName=ZtaMDev.deltascript-vscode)
[![License](https://img.shields.io/github/license/ZtaMDev/DeltaScript?style=for-the-badge)](https://github.com/ZtaMDev/DeltaScript/blob/CrystalMain/LICENSE)

Language support for [DeltaScript](https://www.npmjs.com/package/deltascript): syntax highlighting, inline diagnostics (syntax and types), completions, hovers with code previews, go to definition.

## Features

- Syntax highlighting (keywords, types, function declarations/calls, member calls, `maybe/true/false`, `::Type` annotations).
- Language configuration (comments, brackets, auto-closing pairs).
- Inline diagnostics via LSP (syntax and DeltaScript type errors) with red squiggles and Problems entries.
  - Includes function return type checking: mismatches at `return` sites and missing `return` when a function declares `::ReturnType`.
- Smarter completions:
  - Keywords (async/await, control flow, declarations).
  - Types (num, str, mbool, obj, arr) and constants (true, false, maybe).
  - `spec.*` helpers (log, error, warn, info, debug, success, input).
  - In-scope/local identifiers and previously typed words.
  - Snippets (function and class).
- Hover:
  - Keyword/tooltips for `mut`, `inmut`, `func`, `interface`, `spec.*`.
  - Code preview of symbol definitions (functions, classes, interfaces, variables).
- Go to Definition, Document/Workspace Symbols, References, Rename, Signature Help.

## Keywords

DeltaScript, deltascript, ds, language support, syntax highlighting, typed superset, custom language, LSP, diagnostics, code frames, interfaces, classes, return types, mbool, maybe, spectral logs, spectrallogs, compile to JavaScript, transpiler, JavaScript superset, ESM

## Requirements

- VS Code 1.84+
- Node.js 18+
- The extension starts a bundled LSP server and uses the DeltaScript transpiler for diagnostics. Load order:
  1) `extension/server/transpiler.js` (bundled copy you can update when building the language)
  2) `deltascript/dist/transpiler.js` (installed package)
  3) `../../dist/transpiler.js` (when developing side-by-side)

## Usage

- Open a `.ds` file.
- You will get colorization, inline errors (syntax + type), completions, hover details with code previews, go-to-definition, and more.

## License

MIT
