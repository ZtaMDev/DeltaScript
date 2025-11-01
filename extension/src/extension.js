const path = require('path');
const vscode = require('vscode');
let LanguageClient, TransportKind;
try {
  ({ LanguageClient, TransportKind } = require('vscode-languageclient/node'));
} catch {}

/** @type {any} */
let client = null;
let out = null;
let lspReady = false;

function activate(context) {
  out = vscode.window.createOutputChannel('DeltaScript');
  out.appendLine('[DeltaScript] Activating extension');
  if (LanguageClient && TransportKind) {
    try {
      const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
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
        }).catch(e => {
          out.appendLine('[DeltaScript] LSP onReady error: ' + String(e && e.message || e));
          // Fall back to clientless but keep client running
        });
      } else {
        // No onReady available; keep clientless providers active
        out.appendLine('[DeltaScript] LSP client does not expose onReady; using fallback providers');
      }
    } catch (e) {
      try { out.appendLine('[DeltaScript] Failed to start LSP: ' + String(e && e.message || e)); } catch {}
    }
  }
  // Always register clientless features as a safety net; they no-op once LSP is ready
  registerClientlessFeatures(context);
}

function deactivate() {
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
    'async','await','break','continue','switch','case','default'
  ];
  const TYPES = ['num','str','mbool','obj','arr'];
  const SPEC_METHODS = ['log','error','warn','info','debug','success','input'];

  for (const sel of selectors) {
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(sel, {
    provideCompletionItems(doc, pos) {
      if (lspReady) return undefined;
      const items = [];
      const seen = new Set();
      const push = (ci) => { if (!seen.has(ci.label)) { seen.add(ci.label); items.push(ci); } };
      for (const k of KEYWORDS) items.push(new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
      for (const t of TYPES) items.push(new vscode.CompletionItem(t, vscode.CompletionItemKind.TypeParameter));
      for (const m of SPEC_METHODS) items.push(new vscode.CompletionItem(`spec.${m}`, vscode.CompletionItemKind.Function));
      // Prior identifiers before cursor
      try {
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
  }, ['.', ':', '<', '>']));

  context.subscriptions.push(vscode.languages.registerHoverProvider(sel, {
    provideHover(doc, pos) {
      if (lspReady) return null;
      const word = getWordAt(doc, pos);
      if (!word) return null;
      if (TYPES.includes(word)) {
        const md = new vscode.MarkdownString(word === 'mbool' ? '**Type** mbool\n\nTri-state logical (true/false/maybe).' : `**Type** ${word}`);
        return new vscode.Hover(md);
      }
      if (word === 'maybe') {
        return new vscode.Hover(new vscode.MarkdownString('**Constant** maybe\n\nIndeterminate logical value.'));
      }
      if (word === 'mut') {
        return new vscode.Hover(new vscode.MarkdownString('**Keyword** mut\n\nExplicit mutation assignment while the variable remains mutable.'));
      }
      if (word === 'inmut') {
        return new vscode.Hover(new vscode.MarkdownString('**Keyword** inmut\n\nMarks an existing let as immutable from this point (like const). Further mutations are errors.'));
      }
      if (word === 'func') {
        return new vscode.Hover(new vscode.MarkdownString('**Keyword** func\n\nDeclares a function: `func Name(params) { ... }`.'));
      }
      if (word === 'spec') {
        return new vscode.Hover(new vscode.MarkdownString('**spec**\n\nDeltaScript logging API with methods: log, error, warn, info, debug, success, input.'));
      }
      const around = doc.getText(new vscode.Range(new vscode.Position(Math.max(0, pos.line - 2), 0), new vscode.Position(pos.line + 2, 2000)));
      if (/spec\s*\.\s*log\b/.test(around) && word === 'log') return new vscode.Hover(new vscode.MarkdownString('**spec.log**\n\nInfo logging.'));
      if (/spec\s*\.\s*error\b/.test(around) && word === 'error') return new vscode.Hover(new vscode.MarkdownString('**spec.error**\n\nError logging.'));
      if (/spec\s*\.\s*warn\b/.test(around) && word === 'warn') return new vscode.Hover(new vscode.MarkdownString('**spec.warn**\n\nWarning logging.'));
      if (/spec\s*\.\s*info\b/.test(around) && word === 'info') return new vscode.Hover(new vscode.MarkdownString('**spec.info**\n\nInformational logging.'));
      if (/spec\s*\.\s*debug\b/.test(around) && word === 'debug') return new vscode.Hover(new vscode.MarkdownString('**spec.debug**\n\nDebug logging.'));
      if (/spec\s*\.\s*success\b/.test(around) && word === 'success') return new vscode.Hover(new vscode.MarkdownString('**spec.success**\n\nSuccess logging.'));
      if (/spec\s*\.\s*input\b/.test(around) && word === 'input') return new vscode.Hover(new vscode.MarkdownString('**spec.input**\n\nAsync input prompt.'));
      const sym = findSymbolInDoc(doc, word);
      if (sym) {
        return new vscode.Hover(new vscode.MarkdownString(`**${sym.kind}** ${sym.name}`));
      }
      return null;
    }
  }));

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(sel, {
    provideDefinition(doc, pos) {
      if (lspReady) return null;
      const word = getWordAt(doc, pos);
      if (!word) return null;
      const sym = findSymbolInDoc(doc, word);
      if (!sym) return null;
      return new vscode.Location(doc.uri, sym.range);
    }
  }));
  }
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

module.exports = { activate, deactivate };
