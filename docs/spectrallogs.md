# SpectralLogs Integration

DeltaScript integrates with [SpectralLogs](https://ztamdev.github.io/SpectralLogs/) to provide colorful, structured logging and simple input prompts.

## Modes

DeltaScript supports three modes of integration. The CLI will choose the best one automatically, but you can control it with flags.

1) Package imports (preferred when installed)

```ts
import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'
```

- Used when `node_modules/spectrallogs` exists in your project.
- No top‑level await; works in Node and bundlers.

2) CDN imports (force with `--spectral-cdn`)

```
import spec from "https://esm.sh/spectrallogs"
import specweb from "https://esm.sh/spectrallogs/web"
```

- Ideal for browser‑first demos without installing packages.

3) Shim fallback (no package, no CDN)

```
# defined automatically at file top
const spec = (() => {
  const mk = (lvl) => (...a) => (console[lvl] ? console[lvl](...a) : console.log(...a))
  const input = async (q) => {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') return window.prompt(q) ?? ''
    try {
      const rl = await import('node:readline/promises');
      const { stdin, stdout } = await import('node:process');
      const r = rl.createInterface({ input: stdin, output: stdout });
      const ans = await r.question(q + ' ');
      r.close();
      return ans;
    } catch { return '' }
  }
  return { log: mk('log'), error: mk('error'), warn: mk('warn'), info: mk('info'), debug: mk('debug'), success: (...a) => console.log(...a), input }
})()

const specweb = {}
```

- Provides `spec.log`, `spec.error`, `spec.warn`, `spec.info`, `spec.debug`, `spec.success`, and async `spec.input(question)`.
- Works in Node and browser (uses `window.prompt` if available).

## CLI flags

- `--no-builtins`: disables integration and hides console tips.
- `--migrate-to-spec`: rewrites `console.*` into `spec.*` in emitted JS.
- `--spectral-cdn`: forces CDN imports instead of package imports/shim.

## Gentle warnings and tips

- When `console.*` is detected, the CLI prints a concise yellow warning with the filename once.
- If many occurrences are found, a tip suggests using `--migrate-to-spec`.
- In `dsc dev`, only the first warning is shown per session; later ones are suppressed.

## Examples

```ts
func Main() {
  spec.log("Hello")
  const name = await spec.input("Your name?")
  spec.success("Welcome, " + name)
}
```

See more examples under the repository `examples/` folder.
