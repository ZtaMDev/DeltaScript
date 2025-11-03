# Configuration (dsk.config.ds)

DeltaScript uses a simple JSON‑like config file named `dsk.config.ds` at the project root.

## Example

```ts
export default {
  module: 'cjs',
  outDir: 'dist',
  entry: 'src',
  include: ['src'],
  exclude: ['node_modules'],
  builtins: true
}
```

## Fields

- `module`: currently informational; output is ESM JS.
- `outDir`: directory where compiled `.js` files are placed.
- `entry`: directory where `.ds` sources are discovered.
- `include`: array of paths to include (relative or absolute). Optional.
- `exclude`: array of paths to exclude. Optional.
- `builtins`: enable SpectralLogs integration and console tips. Default `true`.

## Tips

- In single‑file runs (`dsc file.ds`) the CLI does not require a config and will avoid noisy warnings. It writes to a temporary `.mjs` regardless of `outDir`.
- In watch mode, only files ending with `.ds` are considered.
