# Language Guide

DeltaScript is a typed superset that compiles to JavaScript (ESM). This guide highlights the core syntax and typing model.

## Files and Modules

- File extension: `.ds`
- Emitted JavaScript: `.js` (ESM) when building; `.mjs` temp when running a single file.
- Imports/exports follow JavaScript semantics (compiler preserves them).

## Types and Annotations

Attach types with `::`.

- Primitives: `num`, `str`
- Logical maybe: `mbool` → true/false/maybe (runtime may treat `maybe` as nondeterministic)
- Arrays: `arr`, generic arrays: `arr<T>`
- Objects: `obj`
- Custom interfaces/classes: use their identifier

Examples:

```
let n::num = 3
let s::str = "hello"
let maybeFlag::mbool = maybe
let flags::arr<mbool> = [true, false, maybe]
let bag::arr = [1, "a", true]  # untyped array
let cfg::obj = { debug: true }
```

Reassignment must conform to the declared type.

## Functions

Use `func` instead of `function`.

```
func Sum(a::num, b::num) {
  return a + b
}

func Main(x::num = 3) {
  spec.log("x:", x)
}
```

- Default values are supported. The compiler correctly infers the type ignoring the default literal in the type signature.
- Return types are inferred; explicit annotations are optional.

## Classes

```
class Counter {
  constructor(initial::num) {
    this.count::num = initial
  }
  inc() { this.count = this.count + 1 }
  add(n::num) { this.count = this.count + n }
}

let c::Counter = new Counter(2)
c.inc()
c.add(5)
```

## Control Flow

```
# for
let i::num = 0
for (i = 0; i < 3; i = i + 1) {
  spec.log("for i:", i)
}

# while
let w::num = 0
while (w < 2) {
  spec.log("while w:", w)
  w = w + 1
}

# conditionals
let opt::str = "B"
if (opt === "A") {
  spec.log("Option A")
} else if (opt === "B") {
  spec.log("Option B")
} else {
  spec.log("Default")
}
```

## Interfaces

Interfaces describe object shapes.

```
interface Person {
  name::str;
  age::num;
  tags::arr<str>;
  meta::obj;
}

func processPerson(p::Person) {
  spec.log("Procesando:", p.name)
  return p.name
}
```

## Errors and Code Frames

The CLI shows concise errors with code frames, including line/column and colorized output. In single‑file runs, errors show a frame for the source file.

## Logging

Use `spec.*` for logging (see SpectralLogs doc). You can still use `console.*`, but the CLI will suggest `spec.*` for a consistent experience. A migration flag exists to rewrite automatically.
