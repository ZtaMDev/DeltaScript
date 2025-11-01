const { createConnection, TextDocuments, ProposedFeatures, DiagnosticSeverity, CompletionItemKind, MarkupKind, SymbolKind } = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');

// Try to load DeltaScript transpiler
let transpile;
try {
  // Prefer installed package
  transpile = require('./transpiler.js');
} catch (e) {
  try {
    // Fallback to workspace relative path if running unpacked
    transpile = require('./transpiler.js');
  } catch {}
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
      textDocumentSync: documents.syncKind,
      diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false }
    }
  };
});

function validateTextDocument(textDocument) {
  const text = textDocument.getText();
  const diagnostics = [];
  if (!transpile || typeof transpile.transpileSpark !== 'function') {
    return diagnostics; // no engine; avoid noisy diagnostics
  }
  try {
    // Use fileName to help error messages
    transpile.transpileSpark(text, textDocument.uri);
  } catch (err) {
    const line = Number(err?.line ?? 1) - 1;
    const column = Number(err?.column ?? 1) - 1;
    const message = String(err?.message || 'Syntax error');
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: { start: { line, character: Math.max(0, column) }, end: { line, character: Math.max(0, column + 1) } },
      message,
      source: 'DeltaScript'
    });
  }
  return diagnostics;
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
  const diagnostics = validateTextDocument(change.document);
  buildSymbolIndex(change.document.uri, change.document.getText());
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

documents.onDidOpen(async (open) => {
  const diagnostics = validateTextDocument(open.document);
  buildSymbolIndex(open.document.uri, open.document.getText());
  connection.sendDiagnostics({ uri: open.document.uri, diagnostics });
});

connection.onDidChangeWatchedFiles(() => {
  for (const doc of documents.all()) {
    const diagnostics = validateTextDocument(doc);
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  }
});

documents.listen(connection);
connection.listen();

// Workspace scan on initialized
connection.onInitialized(() => {
  scanWorkspace();
});

function uriToFsPath(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'file:') return '';
    return process.platform === 'win32' ? u.pathname.replace(/^\//, '').replace(/\//g, '\\') : u.pathname;
  } catch { return ''; }
}

const fs = require('fs');
const path = require('path');

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
  'if','else','for','while','try','catch','finally','return','new','throw','extends','implements'
];
const TYPES = ['num','str','mbool','obj','arr'];
const SPEC_METHODS = ['log','error','warn','info','debug','success','input'];

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const items = [];
  // Keywords
  for (const k of KEYWORDS) items.push({ label: k, kind: CompletionItemKind.Keyword });
  // Types
  for (const t of TYPES) items.push({ label: t, kind: CompletionItemKind.TypeParameter });
  // spec.* methods
  for (const m of SPEC_METHODS) items.push({ label: `spec.${m}`, kind: CompletionItemKind.Function });
  // Local symbols
  const idx = symbolIndex.get(doc.uri);
  if (idx) {
    for (const s of idx.symbols) {
      items.push({ label: s.name, kind: kindToCompletion(s.kind) });
    }
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
    return { contents: { kind: MarkupKind.Markdown, value: `**${kind}** ${sym.name}` } };
  }
  if (TYPES.includes(word)) {
    return { contents: { kind: MarkupKind.Markdown, value: `Type 
\n- ${word === 'mbool' ? 'Tri-state logical (true/false/maybe)' : 'Primitive type'}` } };
  }
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
