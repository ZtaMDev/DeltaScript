const { createConnection, TextDocuments, ProposedFeatures, DiagnosticSeverity, CompletionItemKind, MarkupKind, SymbolKind } = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { pathToFileURL, fileURLToPath } = require('url');
const fs = require('fs');
const path = require('path');

// Try to load DeltaScript transpiler (supports ESM bundled and package fallback)
let transpile;
async function ensureTranspilerLoaded() {
  if (transpile) return transpile;
  // 1) Bundled transpiler.js (ESM)
  try {
    const esm = await import(pathToFileURL(path.join(__dirname, 'transpiler.js')).href);
    const mod = esm?.default && esm.default.transpileSpark ? esm.default : esm;
    if (mod?.transpileSpark) { transpile = mod; return transpile; }
  } catch {}
  // 2) Installed package (CJS/ESM)
  try {
    const pkg = await import('deltascript/dist/transpiler.js');
    const mod = pkg?.default && pkg.default.transpileSpark ? pkg.default : pkg;
    if (mod?.transpileSpark) { transpile = mod; return transpile; }
  } catch {}
  // 3) Workspace repo dist (CJS/ESM)
  try {
    const local = await import(pathToFileURL(path.join(__dirname, '../../dist/transpiler.js')).href);
    const mod = local?.default && local.default.transpileSpark ? local.default : local;
    if (mod?.transpileSpark) { transpile = mod; return transpile; }
  } catch {}
  return null;
}

function withSilencedConsole(fn) {
  const origError = console.error;
  const origWarn = console.warn;
  const origLog = console.log;
  try {
    console.error = () => {};
    console.warn = () => {};
    // Keep normal logs quiet during validation
    console.log = () => {};
    return fn();
  } finally {
    console.error = origError;
    console.warn = origWarn;
    console.log = origLog;
  }
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
/** @type {Map<string, any>} */
const symbolIndex = new Map(); // uri -> { symbols: Array<{name, kind, range, params?: string[]}>, words:Set, refs: Map<string, Array<{range}>> }

/** @type {string[]} */
let workspaceFoldersFs = [];

connection.onInitialize((params) => {
  try {
    if (Array.isArray(params.workspaceFolders)) {
      workspaceFoldersFs = params.workspaceFolders
        .map(f => uriToFsPath(f.uri))
        .filter(Boolean);
    } else if (params.rootUri) {
      const p = uriToFsPath(params.rootUri);
      if (p) workspaceFoldersFs = [p];
    }
  } catch {}
  return {
    capabilities: {
      textDocumentSync: documents.syncKind
    }
  };
});

async function validateTextDocument(textDocument) {
  const text = textDocument.getText();
  /** @type {import('vscode-languageserver-types').Diagnostic[]} */
  const diagnostics = [];
  const tp = await ensureTranspilerLoaded();
  if (!tp || typeof tp.transpileSpark !== 'function') {
    return diagnostics; // no engine; avoid noisy diagnostics
  }
  const offsetFn = buildInterfaceOffsetAdjuster(text);
  try {
    // transpileSpark may either:
    // - return JS string, or
    // - return { code, diagnostics }
    const fsPath = uriToFsPath(textDocument.uri) || textDocument.uri;
    const result = await withSilencedConsole(() => tp.transpileSpark(text, fsPath));
    let js = '';
    if (result && typeof result === 'object' && 'code' in result) {
      js = String(result.code || '');
      if (Array.isArray(result.diagnostics)) {
        for (const d of result.diagnostics) {
          const rawL = Math.max(1, Number(d?.line ?? 1));
          const msgStr = String(d?.message || '');
          const applyOffset = /syntax error/i.test(msgStr);
          const l = Math.max(0, (applyOffset ? offsetFn(rawL) : rawL) - 1);
          const c = Math.max(0, Number(d?.column ?? 1) - 1);
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: { start: { line: l, character: c }, end: { line: l, character: c + 1 } },
            message: String(d?.message || 'Error'),
            source: 'DeltaScript'
          });
        }
      }
    } else if (typeof result === 'string') {
      js = result;
    }
    // Optional JS syntax check: skip for ESM or empty output to avoid false positives
    if (js && js.trim() && !/\bimport\b|\bexport\b/.test(js)) {
      try { new Function(js); } catch (e) {
        const msg = String(e?.message || 'Generated JS syntax error');
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: `[JS] ${msg}`,
          source: 'DeltaScript'
        });
      }
    }
  } catch (err) {
    // transpiler threw; it may contain a single error or a list in err.errors
    const list = Array.isArray(err?.errors) ? err.errors : [err];
    for (const e of list) {
      const rawL = Math.max(1, Number(e?.line ?? 1));
      const msgStr = String(e?.message || '');
      const applyOffset = /syntax error/i.test(msgStr);
      const line = Math.max(0, (applyOffset ? offsetFn(rawL) : rawL) - 1);
      const column = Math.max(0, Number(e?.column ?? 1) - 1);
      const message = String(e?.message || 'Syntax error');
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start: { line, character: column }, end: { line, character: column + 1 } },
        message,
        source: 'DeltaScript'
      });
    }
  }
  return diagnostics;
}

// Build a function that adjusts line numbers to account for removed interface blocks
function buildInterfaceOffsetAdjuster(text) {
  // Find all interface blocks and compute cumulative removed lines before any given line
  const blocks = [];
  const re = /(^|\n)\s*interface\s+[A-Za-z_$][\w$]*\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const startIdx = m.index + (m[1] ? m[1].length : 0);
    const startLine = indexToLine(text, startIdx) + 1; // 1-based
    // Find matching closing brace for this block
    let i = startIdx;
    let depth = 0;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const endLine = indexToLine(text, i) + 1; // line after '}'
    const removed = Math.max(0, endLine - startLine + 1);
    if (removed > 0) blocks.push({ startLine, endLine, removed });
  }
  // Sort blocks by startLine
  blocks.sort((a,b) => a.startLine - b.startLine);
  return function adjust(line1Based) {
    let add = 0;
    for (const b of blocks) {
      if (b.endLine < line1Based) add += b.removed;
      else break;
    }
    return line1Based + add;
  };
}

function indexToLine(text, idx) {
  let line = 0;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function buildSymbolIndex(uri, text) {
  const symbols = [];
  const words = new Set();
  const refs = new Map();
  // func definitions: func Name( ... )
  const funcRe = /\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
  // class definitions: class Name
  const classRe = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  // interface definitions: interface Name
  const ifaceRe = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  // variable declarations: (let|const) name(::Type)?
  const varRe = /\b(let|const)\s+([A-Za-z_][A-Za-z0-9_]*)(\s*::\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*<[^>]+>)?))?/g;

  const toPos = (idx) => {
    // compute line/character from index
    const pre = text.slice(0, idx);
    const lines = pre.split(/\r?\n/);
    const line = lines.length - 1;
    const character = lines[lines.length - 1].length;
    return { line, character };
  };

  const pushSymbol = (name, kind, startIdx, endIdx, params) => {
    const start = toPos(startIdx);
    const end = toPos(endIdx);
    symbols.push({ name, kind, range: { start, end }, params });
    words.add(name);
  };

  let m;
  while ((m = funcRe.exec(text)) !== null) {
    const paramsRaw = (m[2] || '').trim();
    const params = paramsRaw ? paramsRaw.split(',').map(s => s.trim()) : [];
    pushSymbol(m[1], SymbolKind.Function, m.index, m.index + m[0].length, params);
  }
  while ((m = classRe.exec(text)) !== null) {
    pushSymbol(m[1], SymbolKind.Class, m.index, m.index + m[0].length);
  }
  while ((m = ifaceRe.exec(text)) !== null) {
    pushSymbol(m[1], SymbolKind.Interface, m.index, m.index + m[0].length);
  }
  while ((m = varRe.exec(text)) !== null) {
    pushSymbol(m[2], SymbolKind.Variable, m.index, m.index + m[0].length);
    if (m[4]) words.add(m[4]);
  }

  // Build simple references map (word occurrences)
  const wordRe = /[A-Za-z_][A-Za-z0-9_]*/g;
  let mw;
  const toRange = (start, end) => ({ start: toPos(start), end: toPos(end) });
  while ((mw = wordRe.exec(text)) !== null) {
    const w = mw[0];
    const range = toRange(mw.index, wordRe.lastIndex);
    if (!refs.has(w)) refs.set(w, []);
    refs.get(w).push({ range });
  }

  symbolIndex.set(uri, { symbols, words, refs });
}

documents.onDidChangeContent(async (change) => {
  const diagnostics = await validateTextDocument(change.document);
  buildSymbolIndex(change.document.uri, change.document.getText());
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

documents.onDidOpen(async (open) => {
  const diagnostics = await validateTextDocument(open.document);
  buildSymbolIndex(open.document.uri, open.document.getText());
  connection.sendDiagnostics({ uri: open.document.uri, diagnostics });
});

connection.onDidChangeWatchedFiles(async () => {
  for (const doc of documents.all()) {
    const diagnostics = await validateTextDocument(doc);
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  }
});

documents.listen(connection);
connection.listen();

// Workspace scan on initialized
connection.onInitialized(() => {
  scanWorkspace();
});

// fs and path are imported at top (ESM)

function scanWorkspace() {
  const seen = new Set();
  for (const folder of workspaceFoldersFs) {
    walk(folder, 0, 3, 1000, (fp) => {
      if (fp.endsWith('.ds') && !seen.has(fp)) {
        seen.add(fp);
        try {
          const text = fs.readFileSync(fp, 'utf8');
          const uri = 'file://' + (process.platform === 'win32' ? '/' : '') + fp.replace(/\\/g, '/');
          buildSymbolIndex(uri, text);
        } catch {}
      }
    });
  }
}

function walk(dir, depth, maxDepth, maxFiles, onFile, state={count:0}) {
  if (depth > maxDepth || state.count > maxFiles) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (state.count > maxFiles) return;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      // skip typical deps
      if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      walk(fp, depth + 1, maxDepth, maxFiles, onFile, state);
    } else {
      state.count++;
      onFile(fp);
    }
  }
}

// Command to force reindex
connection.onRequest('deltascript/reindex', () => {
  scanWorkspace();
  return { ok: true };
});

// ----------------------------------
// Completion
// ----------------------------------
const KEYWORDS = [
  'func','let','const','class','interface','inmut','mut','call',
  'if','else','for','while','try','catch','finally','return','new','throw','extends','implements',
  'async','await','break','continue','switch','case','default'
];
const TYPES = ['num','str','mbool','obj','arr'];
const SPEC_METHODS = ['log','error','warn','info','debug','success','input'];
const CONST_VALUES = ['true','false','maybe'];

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const items = [];
  const seen = new Set();
  const push = (label, kind) => { if (!seen.has(label)) { seen.add(label); items.push({ label, kind }); } };

  // Keywords
  for (const k of KEYWORDS) push(k, CompletionItemKind.Keyword);
  // Types
  for (const t of TYPES) push(t, CompletionItemKind.TypeParameter);
  // Constants
  for (const v of CONST_VALUES) push(v, CompletionItemKind.Constant);
  // spec.* methods
  for (const m of SPEC_METHODS) push(`spec.${m}`, CompletionItemKind.Function);

  // Local symbols with simple scope/position filtering
  const idx = symbolIndex.get(doc.uri);
  const text = doc.getText();
  const offset = positionToOffset(text, params.position);
  if (idx) {
    const cursorLevel = blockLevelAt(text, offset);
    for (const s of idx.symbols) {
      // For variables, suggest only if declared before cursor position and in-scope by naive block level
      const declOffset = positionToOffset(text, s.range.start);
      const startsBefore = declOffset <= offset;
      if (s.kind === SymbolKind.Variable) {
        const declLevel = blockLevelAt(text, declOffset);
        if (startsBefore && declLevel <= cursorLevel) push(s.name, kindToCompletion(s.kind));
      } else {
        // functions/classes/interfaces are globally suggestible
        push(s.name, kindToCompletion(s.kind));
      }
    }
  }

  // Contextual: after 'spec.' prefer spec methods
  const tail = text.slice(Math.max(0, offset - 50), offset);
  if (/spec\s*\.$/.test(tail)) {
    for (const mth of SPEC_METHODS) push(mth, CompletionItemKind.Method);
  }

  // Previously seen words before cursor in the same document
  const prior = text.slice(0, offset);
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(prior)) !== null) {
    const w = m[0];
    // Skip if it's a keyword or type to avoid noise
    if (KEYWORDS.includes(w) || TYPES.includes(w)) continue;
    push(w, CompletionItemKind.Text);
  }

  // Snippets
  items.push({
    label: 'func-snippet',
    kind: CompletionItemKind.Snippet,
    insertTextFormat: 2,
    insertText: 'func ${1:Name}(${2:args}) {\n  $0\n}',
    detail: 'Function template'
  });
  items.push({
    label: 'class-snippet',
    kind: CompletionItemKind.Snippet,
    insertTextFormat: 2,
    insertText: 'class ${1:Name} {\n  constructor(${2:params}) {\n    $0\n  }\n}',
    detail: 'Class template'
  });
  return items;
});

function kindToCompletion(k) {
  switch (k) {
    case SymbolKind.Function: return CompletionItemKind.Function;
    case SymbolKind.Class: return CompletionItemKind.Class;
    case SymbolKind.Interface: return CompletionItemKind.Interface;
    case SymbolKind.Variable: return CompletionItemKind.Variable;
    default: return CompletionItemKind.Text;
  }
}

// ----------------------------------
// Hover
// ----------------------------------
connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const pos = params.position;
  const offset = positionToOffset(doc.getText(), pos);
  const word = getWordAt(doc.getText(), offset);
  if (!word) return null;

  const idx = symbolIndex.get(doc.uri);
  const sym = idx?.symbols.find(s => s.name === word);
  if (sym) {
    const kind = SymbolKind[sym.kind] || 'Symbol';
    const text = doc.getText();
    const defLine = sym.range.start.line;
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, defLine);
    const end = Math.min(lines.length - 1, defLine + 4);
    const snippet = lines.slice(start, end + 1).join('\n');
    const md = `**${kind}** ${sym.name}\n\n\`\`\`deltascript\n${snippet}\n\`\`\``;
    return { contents: { kind: MarkupKind.Markdown, value: md } };
  }
  if (TYPES.includes(word)) {
    return { contents: { kind: MarkupKind.Markdown, value: `Type 
\n- ${word === 'mbool' ? 'Tri-state logical (true/false/maybe)' : 'Primitive type'}` } };
  }
  if (word === 'mut') {
    return { contents: { kind: MarkupKind.Markdown, value: `**Keyword** mut\n\nExplicit mutation assignment while the variable remains mutable.` } };
  }
  if (word === 'inmut') {
    return { contents: { kind: MarkupKind.Markdown, value: `**Keyword** inmut\n\nMarks an existing let as immutable from this point (like const). Further mutations are errors.` } };
  }
  if (word === 'func') {
    return { contents: { kind: MarkupKind.Markdown, value: `**Keyword** func\n\nDeclares a function: \`func Name(params) { ... }\`.` } };
  }
  if (word === 'interface') {
    return { contents: { kind: MarkupKind.Markdown, value: `**Keyword** interface\n\nDeclares a structural type: \`interface Name { field::Type; }\`.` } };
  }
  // spec and spec methods
  if (word === 'spec') {
    return { contents: { kind: MarkupKind.Markdown, value: `**spec**\n\nDeltaScript logging API with methods: log, error, warn, info, debug, success, input.` } };
  }
  const around = doc.getText().slice(Math.max(0, offset - 40), offset + 40);
  if (/spec\s*\.\s*log\b/.test(around) && word === 'log') return { contents: { kind: MarkupKind.Markdown, value: `**spec.log**\n\nInfo logging.` } };
  if (/spec\s*\.\s*error\b/.test(around) && word === 'error') return { contents: { kind: MarkupKind.Markdown, value: `**spec.error**\n\nError logging.` } };
  if (/spec\s*\.\s*warn\b/.test(around) && word === 'warn') return { contents: { kind: MarkupKind.Markdown, value: `**spec.warn**\n\nWarning logging.` } };
  if (/spec\s*\.\s*info\b/.test(around) && word === 'info') return { contents: { kind: MarkupKind.Markdown, value: `**spec.info**\n\nInformational logging.` } };
  if (/spec\s*\.\s*debug\b/.test(around) && word === 'debug') return { contents: { kind: MarkupKind.Markdown, value: `**spec.debug**\n\nDebug logging.` } };
  if (/spec\s*\.\s*success\b/.test(around) && word === 'success') return { contents: { kind: MarkupKind.Markdown, value: `**spec.success**\n\nSuccess logging.` } };
  if (/spec\s*\.\s*input\b/.test(around) && word === 'input') return { contents: { kind: MarkupKind.Markdown, value: `**spec.input**\n\nAsync input prompt.` } };
  if (word === 'maybe') {
    return { contents: { kind: MarkupKind.Markdown, value: `Constant 
\n- Represents an indeterminate logical value.` } };
  }
  return null;
});

// ----------------------------------
// Go to Definition
// ----------------------------------
connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const offset = positionToOffset(doc.getText(), params.position);
  const word = getWordAt(doc.getText(), offset);
  if (!word) return null;
  const idx = symbolIndex.get(doc.uri);
  const sym = idx?.symbols.find(s => s.name === word);
  if (!sym) return null;
  return { uri: doc.uri, range: sym.range };
});

function positionToOffset(text, position) {
  let line = 0, idx = 0;
  while (line < position.line) {
    const nl = text.indexOf('\n', idx);
    if (nl === -1) return text.length;
    idx = nl + 1; line++;
  }
  return idx + position.character;
}

function getWordAt(text, offset) {
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index <= offset && re.lastIndex >= offset) return m[0];
  }
  return null;
}

function uriToFsPath(uri) {
  if (!uri) return null;
  try {
    if (uri.startsWith('file://')) return fileURLToPath(uri);
  } catch {}
  try {
    const u = new URL(uri);
    if (u.protocol === 'file:') return fileURLToPath(u);
  } catch {}
  // Fallback naive decode
  try { return decodeURIComponent(uri.replace(/^file:\/\//, '')); } catch { return null; }
}

function blockLevelAt(text, offset) {
  let level = 0;
  for (let i = 0; i < offset; i++) {
    const ch = text[i];
    if (ch === '{') level++;
    else if (ch === '}') level = Math.max(0, level - 1);
  }
  return level;
}

// ----------------------------------
// Document & Workspace Symbols
// ----------------------------------
connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const idx = symbolIndex.get(doc.uri);
  if (!idx) return [];
  return idx.symbols.map(s => ({ name: s.name, kind: s.kind, range: s.range, selectionRange: s.range }));
});

connection.onWorkspaceSymbol((params) => {
  const query = (params.query || '').toLowerCase();
  const result = [];
  for (const doc of documents.all()) {
    const idx = symbolIndex.get(doc.uri);
    if (!idx) continue;
    for (const s of idx.symbols) {
      if (!query || s.name.toLowerCase().includes(query)) {
        result.push({ name: s.name, kind: s.kind, location: { uri: doc.uri, range: s.range } });
      }
    }
  }
  return result;
});

// ----------------------------------
// References & Rename
// ----------------------------------
connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  const word = getWordAt(text, positionToOffset(text, params.position));
  if (!word) return [];
  const idx = symbolIndex.get(doc.uri);
  const list = idx?.refs.get(word) || [];
  return list.map(r => ({ uri: doc.uri, range: r.range }));
});

connection.onRenameRequest((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const word = getWordAt(text, positionToOffset(text, params.position));
  if (!word) return null;
  const idx = symbolIndex.get(doc.uri);
  const list = idx?.refs.get(word) || [];
  const changes = {};
  changes[doc.uri] = list.map(r => ({ range: r.range, newText: params.newName }));
  return { changes };
});

// ----------------------------------
// Signature Help
// ----------------------------------
connection.onSignatureHelp((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const offset = positionToOffset(text, params.position);
  // find the identifier before '('
  const upto = text.slice(0, offset);
  const callMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*\($/.exec(upto);
  if (!callMatch) return null;
  const name = callMatch[1];
  const idx = symbolIndex.get(doc.uri);
  const sym = idx?.symbols.find(s => s.name === name && s.kind === SymbolKind.Function);
  if (!sym) return null;
  const paramsList = sym.params || [];
  return {
    signatures: [
      {
        label: `${name}(${paramsList.join(', ')})`,
        parameters: paramsList.map(p => ({ label: p }))
      }
    ],
    activeSignature: 0,
    activeParameter: 0
  };
});
