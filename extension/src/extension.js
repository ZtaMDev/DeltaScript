const path = require('path');
const vscode = require('vscode');
let LanguageClient, TransportKind;
try {
  ({ LanguageClient, TransportKind } = require('vscode-languageclient/node'));
} catch {}

/** @type {any} */
let client = null;

function activate(context) {
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

      client = new LanguageClient('deltascript', 'DeltaScript Language Server', serverOptions, clientOptions);
      context.subscriptions.push(client.start());
      return;
    } catch (e) {
      // fall through to clientless providers
    }
  }
  registerClientlessFeatures(context);
}

function deactivate() {
  if (!client || !client.stop) return undefined;
  return client.stop();
}

function registerClientlessFeatures(context) {
  const sel = { language: 'deltascript', scheme: 'file' };

  const KEYWORDS = [
    'func','let','const','class','interface','inmut','call',
    'if','else','for','while','try','catch','finally','return','new','throw','extends','implements'
  ];
  const TYPES = ['num','str','mbool','obj','arr'];
  const SPEC_METHODS = ['log','error','warn','info','debug','success','input'];

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(sel, {
    provideCompletionItems(doc, pos) {
      const items = [];
      for (const k of KEYWORDS) items.push(new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
      for (const t of TYPES) items.push(new vscode.CompletionItem(t, vscode.CompletionItemKind.TypeParameter));
      for (const m of SPEC_METHODS) items.push(new vscode.CompletionItem(`spec.${m}`, vscode.CompletionItemKind.Function));
      items.push(snippet('func-snippet', 'Function template', 'func ${1:Name}(${2:args}) {\n  $0\n}'));
      items.push(snippet('class-snippet', 'Class template', 'class ${1:Name} {\n  constructor(${2:params}) {\n    $0\n  }\n}'));
      return items;
    }
  }, ['.', ':', '<', '>']));

  context.subscriptions.push(vscode.languages.registerHoverProvider(sel, {
    provideHover(doc, pos) {
      const word = getWordAt(doc, pos);
      if (!word) return null;
      if (TYPES.includes(word)) {
        const md = new vscode.MarkdownString(word === 'mbool' ? '**Type** mbool\n\nTri-state logical (true/false/maybe).' : `**Type** ${word}`);
        return new vscode.Hover(md);
      }
      if (word === 'maybe') {
        return new vscode.Hover(new vscode.MarkdownString('**Constant** maybe\n\nIndeterminate logical value.'));
      }
      const sym = findSymbolInDoc(doc, word);
      if (sym) return new vscode.Hover(new vscode.MarkdownString(`**${sym.kind}** ${sym.name}`));
      return null;
    }
  }));

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(sel, {
    provideDefinition(doc, pos) {
      const word = getWordAt(doc, pos);
      if (!word) return null;
      const sym = findSymbolInDoc(doc, word);
      if (!sym) return null;
      return new vscode.Location(doc.uri, sym.range);
    }
  }));
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
