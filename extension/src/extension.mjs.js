import path from 'path';
import { fileURLToPath } from 'url';
import * as vscode from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {any} */
let client = null;
let out = null;
let lspReady = false;
let clientlessDisposables = [];
let clientlessRegistered = false;

export function activate(context) {
  out = vscode.window.createOutputChannel('DeltaScript');
  out.appendLine('[DeltaScript] Activating extension');

  out.appendLine('[DeltaScript] LanguageClient available: ' + !!LanguageClient);
  out.appendLine('[DeltaScript] TransportKind available: ' + !!TransportKind);
  if (LanguageClient && TransportKind) {
    try {
      const serverModule = context.asAbsolutePath(path.join('server', 'server.mjs'));
      const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

      const serverOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
      };

      const clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'deltascript' }],
        synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ds') }
      };

      out.appendLine('[DeltaScript] LSP server module: ' + serverModule);
      client = new LanguageClient('deltascript', 'DeltaScript Language Server', serverOptions, clientOptions);
      const disp = client.start();
      context.subscriptions.push(disp);
      out.appendLine('[DeltaScript] LSP client starting...');
      if (client && typeof client.onReady === 'function') {
        client.onReady().then(() => {
          lspReady = true;
          out.appendLine('[DeltaScript] LSP client ready');
          // Dispose clientless providers to avoid duplicated hovers/completions
          try {
            for (const d of clientlessDisposables) { try { d.dispose?.(); } catch {} }
            clientlessDisposables = [];
            clientlessRegistered = false;
          } catch {}
        }).catch(e => {
          out.appendLine('[DeltaScript] LSP onReady error: ' + String(e && e.message || e));
          // Fall back to clientless but keep client running
          try { if (!clientlessRegistered) { clientlessDisposables = registerClientlessFeatures(context); clientlessRegistered = true; } } catch {}
        });
      } else {
        // No onReady available; keep clientless providers active
        out.appendLine('[DeltaScript] LSP client does not expose onReady; using fallback providers');
        try { clientlessDisposables = registerClientlessFeatures(context); } catch {}
      }
    } catch (e) {
      try { out.appendLine('[DeltaScript] Failed to start LSP: ' + String(e && e.message || e)); } catch {}
      // Fallback to clientless providers if LSP start fails
      try { clientlessDisposables = registerClientlessFeatures(context); } catch {}
    }
  }
  // If LanguageClient is not available at all, use clientless providers
  if (!LanguageClient || !TransportKind) {
    try { if (!clientlessRegistered) { clientlessDisposables = registerClientlessFeatures(context); clientlessRegistered = true; } } catch {}
  }
}

export function deactivate() {
  if (!client || !client.stop) return undefined;
  return client.stop();
}

function registerClientlessFeatures(context) {
  const selectors = [
    { language: 'deltascript', scheme: 'file' },
    { language: 'deltascript', scheme: 'untitled' }
  ];

  const KEYWORDS = [
    'func','let','const','class','interface','inmut','mut','call',
    'if','else','for','while','try','catch','finally','return','new','throw','extends','implements',
    'async','await','break','continue','switch','case','default','import','from','export'
  ];
  const TYPES = ['num','str','mbool','obj','arr'];
  const SPEC_METHODS = ['log','error','warn','info','debug','success','input'];

  const disposables = [];
  for (const sel of selectors) {
  const d1 = vscode.languages.registerCompletionItemProvider(sel, {
    provideCompletionItems(doc, pos) {
      if (lspReady) return undefined;
      const items = [];
      const seen = new Set();
      const push = (ci) => { if (!seen.has(ci.label)) { seen.add(ci.label); items.push(ci); } };
      for (const k of KEYWORDS) items.push(new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
      for (const t of TYPES) items.push(new vscode.CompletionItem(t, vscode.CompletionItemKind.TypeParameter));
      for (const m of SPEC_METHODS) items.push(new vscode.CompletionItem(`spec.${m}`, vscode.CompletionItemKind.Function));
      // Prior identifiers before cursor
      try {6
        const text = doc.getText();
        const upto = text.slice(0, doc.offsetAt(pos));
        const re = /[A-Za-z_][A-Za-z0-9_]*/g;
        let m;
        while ((m = re.exec(upto)) !== null) {
          const w = m[0];
          if (KEYWORDS.includes(w) || TYPES.includes(w)) continue;
          push(new vscode.CompletionItem(w, vscode.CompletionItemKind.Text));
        }
      } catch {}
      items.push(snippet('func-snippet', 'Function template', 'func ${1:Name}(${2:args}) {\n  $0\n}'));
      items.push(snippet('class-snippet', 'Class template', 'class ${1:Name} {\n  constructor(${2:params}) {\n    $0\n  }\n}'));
      return items;
    }
  }, ['.', ':', '<', '>']);
  context.subscriptions.push(d1); disposables.push(d1);

  // No clientless hover provider to avoid duplicates; rely on LSP hover

  const d3 = vscode.languages.registerDefinitionProvider(sel, {
    provideDefinition(doc, pos) {
      if (lspReady) return null;
      const word = getWordAt(doc, pos);
      if (!word) return null;
      const sym = findSymbolInDoc(doc, word);
      if (!sym) return null;
      return new vscode.Location(doc.uri, sym.range);
    }
  });
  context.subscriptions.push(d3); disposables.push(d3);
  }
  return disposables;
}

function snippet(label, detail, body) {
  const it = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
  it.insertText = new vscode.SnippetString(body);
  it.detail = detail;
  return it;
}

function getWordAt(doc, pos) {
  const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_][A-Za-z0-9_]*/);
  return range ? doc.getText(range) : '';
}

function findSymbolInDoc(doc, name) {
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const mkRange = (line, start, end) => new vscode.Range(new vscode.Position(line, start), new vscode.Position(line, end));
  const reList = [
    { kind: 'Function', re: /\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
    { kind: 'Class', re: /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/ },
    { kind: 'Interface', re: /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\b/ },
    { kind: 'Variable', re: /\b(let|const)\s+([A-Za-z_][A-Za-z0-9_]*)/ , idx:2}
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const r of reList) {
      const m = r.re.exec(line);
      if (m) {
        const idx = r.idx || 1;
        if (m[idx] === name) {
          const start = line.indexOf(m[idx]);
          return { name, kind: r.kind, range: mkRange(i, start, start + m[idx].length) };
        }
      }
    }
  }
  return null;
}


