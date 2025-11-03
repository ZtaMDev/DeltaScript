import { createConnection, TextDocuments, ProposedFeatures, DiagnosticSeverity, CompletionItemKind, MarkupKind, SymbolKind } from 'vscode-languageserver/node.js';
// Early boot log + error handlers
try { console.error('[DeltaScript LSP] server boot'); } catch {}
try {
  process.on('uncaughtException', (e) => { try { console.error('[DeltaScript LSP] uncaughtException:', e && e.stack || String(e)); } catch {} });
  process.on('unhandledRejection', (e) => { try { console.error('[DeltaScript LSP] unhandledRejection:', e && e.stack || String(e)); } catch {} });
} catch {}
import { TextDocument } from 'vscode-languageserver-textdocument';
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to load DeltaScript transpiler (supports ESM bundled and package fallback)
let transpile;
async function ensureTranspilerLoaded() {
  if (transpile) return transpile;
  // Load bundled transpiler (compiled file: transpiler.js)
  try {
    // Preflight: verify critical deps resolve from within the VSIX runtime
    try { await import('acorn'); console.success('[DeltaScript LSP] preflight: acorn OK'); } catch (e) { try { console.success('[DeltaScript LSP] preflight: acorn MISSING:', e?.message || String(e)); } catch {} }
    try { await import('vscode-languageserver-textdocument'); console.success('[DeltaScript LSP] preflight: textdocument OK'); } catch (e) { try { console.success('[DeltaScript LSP] preflight: textdocument MISSING:', e?.message || String(e)); } catch {} }
    const u = new URL('./transpiler.js', import.meta.url).href;
    try { console.success('[DeltaScript LSP] trying transpiler.js:', u); } catch {}
    // Import with a watchdog to surface hangs
    const esm = await Promise.race([
      import(u),
      new Promise((_, rej) => setTimeout(() => rej(new Error('import timeout (5s) for transpiler.js')), 5000))
    ]);
    try { console.success('[DeltaScript LSP] transpiler.js imported, keys:', Object.keys(esm || {})); } catch {}
    const mod = esm?.default && esm.default.transpileSpark ? esm.default : esm;
    if (mod?.transpileSpark) { transpile = mod; try { console.success('[DeltaScript LSP] transpiler.js loaded OK'); } catch {}; return transpile; }
    try { console.error('[DeltaScript LSP] transpiler.js loaded but missing transpileSpark export; mod keys:', Object.keys(mod || {})); } catch {}
  } catch (e) {
    try { console.error('[DeltaScript LSP] failed to load transpiler.js:', e && e.stack || String(e)); } catch {}
  }
  try { console.success('[DeltaScript LSP] no transpiler module found (expected transpiler.js)'); } catch {}
  return null;
}

// (moved reload handler below, after 'connection' initialization)

// (helpers are defined once at bottom; removed duplicate early definitions)

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
// Hover de-duplication state
let _lastHover = { uri: '', line: -1, character: -1, text: '', ts: 0 };
function makeHover(uri, position, mdValue) {
  try {
    const now = Date.now();
    if (_lastHover && _lastHover.uri === uri && _lastHover.line === position.line && _lastHover.character === position.character && _lastHover.text === mdValue && (now - _lastHover.ts) < 1500) {
      return null;
    }
    _lastHover = { uri, line: position.line, character: position.character, text: mdValue, ts: now };
  } catch {}
  return { contents: { kind: MarkupKind.Markdown, value: mdValue } };
}

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
      completionProvider: { resolveProvider: false, triggerCharacters: ['.', ':', '<'] },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      referencesProvider: true,
      renameProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(' , ','] }
    }
  };
});

async function validateTextDocument(textDocument) {
  const text = textDocument.getText();
  /** @type {import('vscode-languageserver-types').Diagnostic[]} */
  const diagnostics = [];
  const tp = await ensureTranspilerLoaded();
  if (!tp || typeof tp.transpileSpark !== 'function') {
    try { console.error('[DeltaScript LSP] transpiler not available or invalid export'); } catch {}
    return diagnostics; // no engine; avoid noisy diagnostics
  }
  const mapLine = buildInterfaceParsedToSourceMapper(text);
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
          const msgStr0 = String(d?.message || '');
          // Drop JS syntax errors reported by transpiler if output is ESM
          if (/Emitted JS Syntax error/i.test(msgStr0) && /\b(import|export)\b/.test(js || '')) {
            continue;
          }
          const rawL = Math.max(1, Number(d?.line ?? 1));
          const msgStr = msgStr0;
          const applyOffset = /syntax error/i.test(msgStr) && !/\(mapped\)/i.test(msgStr);
          const mapped = applyOffset ? mapLine(rawL) : rawL;
          const l = Math.max(0, mapped - 1);
          let c = Math.max(0, Number(d?.column ?? 1) - 1);
          if (applyOffset) {
            try {
              const srcLineText = text.split(/\r?\n/)[l] || '';
              c = mapParsedColumnToSource(srcLineText, c);
            } catch {}
          }
          // Ignore generic Syntax error if it's likely due to a func header with ::ReturnType on this line
          if (/syntax error/i.test(msgStr)) {
            const srcLine = (text.split(/\r?\n/)[l] || '').trim();
            if (lineLooksLikeFuncWithReturnType(srcLine)) {
              continue;
            }
          }
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
  } catch (err) {
    // transpiler threw; it may contain a single error or a list in err.errors
    const list = Array.isArray(err?.errors) ? err.errors : [err];
    for (const e of list) {
      const rawL = Math.max(1, Number(e?.line ?? 1));
      const msgStr = String(e?.message || '');
      // Drop JS syntax errors reported by transpiler if the source is ESM-ish
      if (/Emitted JS Syntax error/i.test(msgStr)) {
        const src = textDocument.getText();
        if (/\b(import|export)\b/.test(src)) {
          continue;
        }
      }
      const applyOffset = /syntax error/i.test(msgStr) && !/\(mapped\)/i.test(msgStr);
      const mapped = applyOffset ? mapLine(rawL) : rawL;
      const line = Math.max(0, mapped - 1);
      let column = Math.max(0, Number(e?.column ?? 1) - 1);
      if (applyOffset) {
        try {
          const srcLineText = text.split(/\r?\n/)[line] || '';
          column = mapParsedColumnToSource(srcLineText, column);
        } catch {}
      }
      // Ignore generic Syntax error if it's likely due to a func header with ::ReturnType on this line
      if (/syntax error/i.test(msgStr)) {
        const srcLine = (text.split(/\r?\n/)[line] || '').trim();
        if (lineLooksLikeFuncWithReturnType(srcLine)) {
          continue;
        }
      }
      const message = String(e?.message || 'Syntax error');
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start: { line, character: column }, end: { line, character: column + 1 } },
        message,
        source: 'DeltaScript'
      });
    }
  }
  // Suppress noisy redeclaration diagnostics; keep all others
  const filtered = diagnostics.filter(d => !/Redeclaration of variable .* in the same scope/i.test(String(d?.message || '')));
  return filtered;
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
    // Find matching closing brace for this block (end at the '}' character)
    let j = startIdx;
    let depth = 0;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { break; } }
    }
    const endLine = indexToLine(text, j) + 1; // line of the closing '}'
    // Removed lines equal the number of lines occupied by the interface block
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

// Build mapping from parsed (interfaces removed) line numbers -> original source line numbers
function buildInterfaceParsedToSourceMapper(text) {
  // 1) Find interface blocks exactly as transpiler removes (char indices)
  const blocks = [];
  const re = /(^|\n)\s*interface\s+[A-Za-z_$][\w$]*\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const startIdx = m.index + (m[1] ? m[1].length : 0);
    let i = startIdx;
    let depth = 0;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const endExclusive = i; // matches transpiler end+1
    blocks.push([startIdx, endExclusive]);
  }
  // 2) Build keep mask and cleaned text
  const keep = new Array(text.length).fill(true);
  for (const [s, e] of blocks) {
    for (let k = s; k < e; k++) keep[k] = false;
  }
  const cleanedChars = [];
  const origIdx = [];
  for (let i = 0; i < text.length; i++) {
    if (keep[i]) { cleanedChars.push(text[i]); origIdx.push(i); }
  }
  const cleaned = cleanedChars.join('');
  // 3) Precompute line start offsets for cleaned and mapping to original
  const cleanedLineStarts = [0];
  for (let i = 0; i < cleaned.length; i++) if (cleaned.charCodeAt(i) === 10) cleanedLineStarts.push(i + 1);
  return function(parsedLine1Based) {
    const idx = Math.max(1, Math.min(parsedLine1Based, cleanedLineStarts.length));
    const startClean = cleanedLineStarts[idx - 1];
    const orig = origIdx[startClean] ?? 0;
    // compute original line number (1-based)
    let line = 1;
    for (let i = 0; i < orig; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
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

// Allow client to reload transpiler on demand (useful after editing transpiler.mjs)
connection.onRequest('deltascript/reloadTranspiler', async () => {
  try {
    transpile = null;
    await ensureTranspilerLoaded();
    // Re-validate all open documents after reload
    for (const doc of documents.all()) {
      const diagnostics = await validateTextDocument(doc);
      connection.sendDiagnostics({ uri: doc.uri, diagnostics });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
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
  // Force refresh transpiler at startup to avoid any stale cache
  (async () => {
    try {
      transpile = null;
      await ensureTranspilerLoaded();
      for (const doc of documents.all()) {
        const diagnostics = await validateTextDocument(doc);
        connection.sendDiagnostics({ uri: doc.uri, diagnostics });
      }
    } catch {}
  })();
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
  'async','await','break','continue','switch','case','default','import','from','export'
];
const TYPES = ['num','str','mbool','obj','arr'];
const SPEC_METHODS = ['log','error','warn','info','debug','success','input'];
const JS_GLOBAL_FUNCS = ['parseInt','parseFloat','isNaN','isFinite','decodeURI','decodeURIComponent','encodeURI','encodeURIComponent','setTimeout','setInterval','clearTimeout','clearInterval','queueMicrotask'];
const JS_GLOBAL_OBJECTS = ['Number','String','Boolean','Array','Object','Map','Set','WeakMap','WeakSet','Date','Math','JSON','RegExp','Promise','Symbol','BigInt','Error','TypeError','RangeError'];
const JS_COMMON_METHODS = ['toString','valueOf','hasOwnProperty','push','pop','shift','unshift','map','filter','reduce','forEach','find','findIndex','slice','splice','includes','indexOf','startsWith','endsWith','trim','toUpperCase','toLowerCase','split','join'];
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
  // JS built-in globals
  for (const f of JS_GLOBAL_FUNCS) push(f, CompletionItemKind.Function);
  for (const o of JS_GLOBAL_OBJECTS) push(o, CompletionItemKind.Class);

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
  if (/spec\s*\.\s*$/.test(tail)) {
    for (const mth of SPEC_METHODS) push(mth, CompletionItemKind.Method);
  }
  // Contextual: generic methods after '.'
  if (/\.\s*$/.test(tail)) {
    for (const mth of JS_COMMON_METHODS) push(mth, CompletionItemKind.Method);
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
  // Hard de-duplication by label+kind (safety in case client aggregates)
  const uniq = [];
  const sig = new Set();
  for (const it of items) {
    const k = `${it.label}::${it.kind}`;
    if (!sig.has(k)) { sig.add(k); uniq.push(it); }
  }
  return uniq;
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

  // Import path hover: if inside a string following import/from, show resolved path + file snippet
  const importInfo = findImportStringAt(doc.getText(), pos);
  if (importInfo) {
    const baseFs = uriToFsPath(doc.uri);
    const resolved = resolveImportPath(baseFs, importInfo.specifier);
    let snippet = '';
    try {
      const raw = fs.readFileSync(resolved.fsPath, 'utf8');
      snippet = raw.split(/\r?\n/).slice(0, 12).join('\n');
    } catch {}
    const shown = resolved.display;
    const md = `**Import**\n\nPath: ${shown}\n\n\`\`\`deltascript\n${snippet}\n\`\`\``;
    return makeHover(doc.uri, pos, md);
  }

  const idx = symbolIndex.get(doc.uri);
  const sym = idx?.symbols.find(s => s.name === word);
  if (sym) {
    const kind = SymbolKind[sym.kind] || 'Symbol';
    const text = doc.getText();
    // If hovering an interface name, show a structured list of its fields
    if (sym.kind === SymbolKind.Interface) {
      const md = renderInterfaceHover(text, sym.name);
      if (md) return makeHover(doc.uri, pos, md);
    }
    // Otherwise fallback to snippet preview
    const defLine = sym.range.start.line;
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, defLine);
    const end = Math.min(lines.length - 1, defLine + 4);
    const snippet = lines.slice(start, end + 1).join('\n');
    const md = `**${kind}** ${sym.name}\n\n\`\`\`deltascript\n${snippet}\n\`\`\``;
    return makeHover(doc.uri, pos, md);
  }
  // If hovering a variable, try to show its annotated interface fields
  if (idx) {
    const v = idx.symbols.find(s => s.name === word && s.kind === SymbolKind.Variable);
    if (v) {
      const text = doc.getText();
      const declLineStart = positionToOffset(text, { line: v.range.start.line, character: 0 });
      const declLineEnd = text.indexOf('\n', declLineStart);
      const declLine = text.slice(declLineStart, declLineEnd === -1 ? text.length : declLineEnd);
      const m = new RegExp(`\\b(let|const)\\s+${word}\\s*::\\s*([A-Za-z_][A-Za-z0-9_]*)`).exec(declLine);
      const typeName = m ? m[2] : null;
      if (typeName) {
        const md = renderInterfaceHover(text, typeName);
        if (md) return makeHover(doc.uri, pos, md);
      }
    }
  }
  // Cross-file: search imported files for the symbol and show snippet
  const imported = collectImportedFiles(doc.getText(), doc.uri);
  for (const imp of imported) {
    try {
      const text = fs.readFileSync(imp.fsPath, 'utf8');
      const uri = 'file://' + (process.platform === 'win32' ? '/' : '') + imp.fsPath.replace(/\\/g, '/');
      // lightweight index on demand
      const localIdx = buildTempSymbolIndex(text);
      const found = localIdx.symbols.find(s => s.name === word);
      if (found) {
        const lines = text.split(/\r?\n/);
        const defLine = found.range.start.line;
        const start = Math.max(0, defLine);
        const end = Math.min(lines.length - 1, defLine + 6);
        const snippet = lines.slice(start, end + 1).join('\n');
        const md = `**${SymbolKind[found.kind] || 'Symbol'}** ${word} (from ${imp.display})\n\n\`\`\`deltascript\n${snippet}\n\`\`\``;
        return makeHover(doc.uri, pos, md);
      }
    } catch {}
  }
  if (TYPES.includes(word)) {
    const md = `Type \n- ${word === 'mbool' ? 'Tri-state logical (true/false/maybe)' : 'Primitive type'}`;
    return makeHover(doc.uri, pos, md);
  }
  if (word === 'mut') {
    return makeHover(doc.uri, pos, `**Keyword** mut\n\nExplicit mutation assignment while the variable remains mutable.`);
  }
  if (word === 'inmut') {
    return makeHover(doc.uri, pos, `**Keyword** inmut\n\nMarks an existing let as immutable from this point (like const). Further mutations are errors.`);
  }
  if (word === 'func') {
    return makeHover(doc.uri, pos, `**Keyword** func\n\nDeclares a function: \`func Name(params) { ... }\`.`);
  }
  if (word === 'interface') {
    return makeHover(doc.uri, pos, `**Keyword** interface\n\nDeclares a structural type: \`interface Name { field::Type; }\`.`);
  }
  // spec and spec methods
  if (word === 'spec') {
    return makeHover(doc.uri, pos, `**spec**\n\nDeltaScript logging API with methods: log, error, warn, info, debug, success, input.`);
  }
  const around = doc.getText().slice(Math.max(0, offset - 40), offset + 40);
  if (/spec\s*\.\s*log\b/.test(around) && word === 'log') return makeHover(doc.uri, pos, `**spec.log**\n\nInfo logging.`);
  if (/spec\s*\.\s*error\b/.test(around) && word === 'error') return makeHover(doc.uri, pos, `**spec.error**\n\nError logging.`);
  if (/spec\s*\.\s*warn\b/.test(around) && word === 'warn') return makeHover(doc.uri, pos, `**spec.warn**\n\nWarning logging.`);
  if (/spec\s*\.\s*info\b/.test(around) && word === 'info') return makeHover(doc.uri, pos, `**spec.info**\n\nInformational logging.`);
  if (/spec\s*\.\s*debug\b/.test(around) && word === 'debug') return makeHover(doc.uri, pos, `**spec.debug**\n\nDebug logging.`);
  if (/spec\s*\.\s*success\b/.test(around) && word === 'success') return makeHover(doc.uri, pos, `**spec.success**\n\nSuccess logging.`);
  if (/spec\s*\.\s*input\b/.test(around) && word === 'input') return makeHover(doc.uri, pos, `**spec.input**\n\nAsync input prompt.`);
  if (word === 'maybe') {
    return makeHover(doc.uri, pos, `Constant \n- Represents an indeterminate logical value.`);
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
  if (sym) return { uri: doc.uri, range: sym.range };
  // Cross-file: search imported files for definition
  const imported = collectImportedFiles(doc.getText(), doc.uri);
  for (const imp of imported) {
    try {
      const text = fs.readFileSync(imp.fsPath, 'utf8');
      const localIdx = buildTempSymbolIndex(text);
      const found = localIdx.symbols.find(s => s.name === word);
      if (found) {
        const uri = 'file://' + (process.platform === 'win32' ? '/' : '') + imp.fsPath.replace(/\\/g, '/');
        return { uri, range: found.range };
      }
    } catch {}
  }
  return null;
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

// -----------------------------
// Import helpers (top-level)
// -----------------------------
function findImportStringAt(text, position) {
  try {
    const lineStartOff = positionToOffset(text, { line: position.line, character: 0 });
    const lineEndIdx = text.indexOf('\n', lineStartOff);
    const lineText = text.slice(lineStartOff, lineEndIdx === -1 ? text.length : lineEndIdx);
    const ch = position.character;
    const m = /(['"])\s*([^'"\n]+?)\s*\1/g;
    let q;
    while ((q = m.exec(lineText)) !== null) {
      const start = q.index;
      const end = m.lastIndex;
      if (ch >= start && ch <= end) {
        if (/\b(import|from)\b/.test(lineText)) return { specifier: q[2] };
      }
    }
  } catch {}
  return null;
}

function resolveImportPath(baseFsPath, spec) {
  try {
    const baseDir = path.dirname(baseFsPath);
    let s = spec;
    if (!/^\.|\//.test(s) && !/^([A-Za-z]:\\|file:\/\/)/.test(s)) s = './' + s;
    const candDs = path.resolve(baseDir, s.endsWith('.ds') ? s : s + '.ds');
    const candJs = path.resolve(baseDir, s.endsWith('.js') ? s : s + '.js');
    if (fs.existsSync(candDs)) return { fsPath: candDs, display: candDs };
    return { fsPath: candJs, display: candJs };
  } catch { return { fsPath: spec, display: spec }; }
}

function buildTempSymbolIndex(text) {
  const symbols = [];
  const funcRe = /\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
  const classRe = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const ifaceRe = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const toPos = (idx) => {
    const pre = text.slice(0, idx);
    const lines = pre.split(/\r?\n/);
    return { line: lines.length - 1, character: lines[lines.length - 1].length };
  };
  let m;
  while ((m = funcRe.exec(text)) !== null) symbols.push({ name: m[1], kind: SymbolKind.Function, range: { start: toPos(m.index), end: toPos(m.index + m[0].length) } });
  while ((m = classRe.exec(text)) !== null) symbols.push({ name: m[1], kind: SymbolKind.Class, range: { start: toPos(m.index), end: toPos(m.index + m[0].length) } });
  while ((m = ifaceRe.exec(text)) !== null) symbols.push({ name: m[1], kind: SymbolKind.Interface, range: { start: toPos(m.index), end: toPos(m.index + m[0].length) } });
  return { symbols };
}

function collectImportedFiles(text, docUri) {
  const res = [];
  try {
    const baseFs = uriToFsPath(docUri);
    const rx = /\bfrom\s+['"]([^'"\n]+)['"]|\bimport\s+['"]([^'"\n]+)['"]/g;
    let m;
    while ((m = rx.exec(text)) !== null) {
      const spec = m[1] || m[2];
      const resolved = resolveImportPath(baseFs, spec);
      res.push(resolved);
    }
  } catch {}
  return res;
}

// Build a markdown hover for an interface: list its fields with types and optional marker
function renderInterfaceHover(text, ifaceName) {
  try {
    // Find the interface block by name
    const headerRe = new RegExp(`(^|\n)\s*interface\s+${ifaceName}\s*\{`, 'g');
    const m = headerRe.exec(text);
    if (!m) return null;
    let i = m.index + (m[1] ? m[1].length : 0);
    // Find opening brace
    i = text.indexOf('{', i);
    if (i === -1) return null;
    let depth = 0;
    let start = -1;
    let end = -1;
    for (let k = i; k < text.length; k++) {
      const ch = text[k];
      if (ch === '{') { depth++; if (depth === 1) start = k + 1; }
      else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (start === -1 || end === -1) return null;
    const body = text.slice(start, end);
    const lines = body.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('//'));
    const fieldRe = /^([A-Za-z_$][\w$]*)(\?)?\s*::\s*([^;]+);?$/;
    const rows = [];
    for (const L of lines) {
      const mm = fieldRe.exec(L);
      if (mm) {
        const name = mm[1];
        const opt = mm[2] ? '?' : '';
        const type = mm[3].trim();
        rows.push(`- \`${name}${opt}\` :: \`${type}\``);
      }
    }
    const header = `**Interface** ${ifaceName}`;
    if (rows.length === 0) return header;
    return `${header}\n\n${rows.join('\n')}`;
  } catch { return null; }
}

// -----------------------------
// Column mapping per line (parsed -> source)
// -----------------------------
function mapParsedColumnToSource(srcLine, parsedCol) {
  const map = buildColumnMapForLine(srcLine);
  if (map.length === 0) return parsedCol;
  const idx = Math.max(0, Math.min(parsedCol, map.length - 1));
  return map[idx];
}

function buildColumnMapForLine(srcLine) {
  let i = 0;
  const n = srcLine.length;
  const outToSrc = [];
  const pushMany = (count, srcIndex) => { for (let k = 0; k < count; k++) outToSrc.push(srcIndex); };
  while (i < n) {
    const rest = srcLine.slice(i);
    // identifier::Type removal
    let m = /^([A-Za-z_$][\w$]*)::([A-Za-z_$<>\[\]]+)/.exec(rest);
    if (m) {
      const id = m[1];
      // emit identifier only
      for (let k = 0; k < id.length; k++) outToSrc.push(i + k);
      i += m[0].length;
      continue;
    }
    // maybe substitution
    m = /^\bmaybe\b/.exec(rest);
    if (m) {
      // transpiler expands to a long expression; map all emitted chars back to start of 'maybe'
      // We approximate with 1:1 by emitting 5 chars to keep mapping sane
      const len = 5; // 'maybe'
      for (let k = 0; k < len; k++) outToSrc.push(i);
      i += len;
      continue;
    }
    // func -> function
    m = /^\bfunc\b/.exec(rest);
    if (m) {
      // 'function' length 8; map to start of 'func'
      pushMany(8, i);
      i += 4;
      continue;
    }
    // default: copy char
    outToSrc.push(i);
    i += 1;
  }
  return outToSrc;
}

// Heuristic: detect `func Name(args)::ReturnType` on a single line (optional async)
function lineLooksLikeFuncWithReturnType(srcLine) {
  try {
    return /^(?:async\s+)?func\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*::\s*[^\{]+\{?\s*$/.test(srcLine);
  } catch { return false; }
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
