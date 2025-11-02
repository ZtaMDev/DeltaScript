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

```ts
let n::num = 3
let s::str = "hello"
let maybeFlag::mbool = maybe
let flags::arr<mbool> = [true, false, maybe]
let bag::arr = [1, "a", true]  # untyped array
let cfg::obj = { debug: true }
```

### Extended interface typing

- Optional fields with `?` are supported:
  ```ts
  interface Product {
    id::num;
    name::str;
    price::num;
    inStock::mbool;
    module?:: "esm" | "cjs"; // optional
  }
  ```
- Union and string-literal types in fields are allowed (e.g., `"esm" | "cjs" | str`).
- Per‑field validation at declaration checks that each provided property matches its field type (shallow).
- `mbool` accepts `true`, `false`, and `maybe`.
- Comments are ignored by validators (lines starting with `//` and blocks `/* ... */`).

Examples:
```ts
let ok1::Product = { id: 1, name: "Laptop", price: 999.99, inStock: true, module: "cjs" };
let ok2::Product = { id: 2, name: "Mouse", price: 29.99, inStock: maybe };
let bad1::Product = { id: 3, name: "Cable", price: "9.99", inStock: true }; // error: price expects num
let bad2::Product = { id: 4, name: "Hub", price: 19.99, inStock: true, module: "commonjs" }; // error: module expects "esm" | "cjs"
```

## Mutability: mut / inmut

- `inmut <var>`: marks an existing `let` variable as immutable from that point forward (like turning it into a const). Further reassignments or `mut <var> = ...` become errors.
- `mut <var> = <expr>`: explicit mutation assignment, allowed only while the variable is still mutable.

Examples:

```ts
let username::str = "Manuel"
let score::num = 42

mut score = 50          // allowed (score is still mutable)
inmut username          // from here, username cannot change

// This will error because username is now immutable:
// mut username = "Other"
```

Reassignment must conform to the declared type.

## Functions

Use `func` instead of `function`.

```ts
func Sum(a::num, b::num) {
  return a + b
}

func Main(x::num = 3) {
  spec.log("x:", x)
}
```

- Default values are supported. The compiler correctly infers the type ignoring the default literal in the type signature.
- Return types are inferred; explicit annotations are optional.

### Function return types

You can explicitly annotate a function's return type after the parameter list using `::ReturnType`.

```ts
func Sum(a::num, b::num)::num {
  return a + b
}

func Wrong()::num {
  return "x"        //error: Return type mismatch (expects num)
}

func NoReturn()::str {
  let x = 1
}                    // error: declares return type str but has no return
```

- The compiler validates every `return` expression against the declared return type.
- Missing return is reported at the `::ReturnType` position.
- When returning an object literal for an interface type, required fields are validated (shallow check):

```ts
interface Person { name::str; age::num; }

func Make()::Person {
  return { name: "A" }    // error: expects Person (missing required: age)
}
```

## Classes

```ts
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

```ts
let i::num = 0
for (i = 0; i < 3; i = i + 1) {
  spec.log("for i:", i)
}

let w::num = 0
while (w < 2) {
  spec.log("while w:", w)
  w = w + 1
}

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

```ts
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
