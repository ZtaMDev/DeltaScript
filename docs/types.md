# Types Reference

This page summarizes DeltaScript's type system and key rules.

## Primitive Types

- `num`: numeric values (integers and floats)
- `str`: strings

## Logical Type (Maybe)

- `mbool`: a tri‑state logical type (true / false / maybe). At runtime `maybe` evaluates nondeterministically (50%) and annotations communicate intent.

## Arrays

- Untyped arrays: `arr`
- Typed arrays: `arr<T>`

Examples:
```ts
let xs::arr = [1, "a", true]
let ys::arr<num> = [1, 2, 3]
let names::arr<str> = ["a", "b"]
let switches::arr<mbool> = [true, false, maybe]
```

## Objects

- `obj`: general purpose object/map.

```ts
let cfg::obj = { debug: true, version: "0.1" }
```

## Interfaces

Interfaces declare object shapes.

```ts
interface Person {
  name::str;
  age::num;
  tags::arr<str>;
  meta::obj;
}
```

### Extended rules

- Optional fields with `?`:
  ```ts
  interface Product {
    id::num;
    name::str;
    price::num;
    inStock::mbool;
    module?:: "esm" | "cjs"; // optional
  }
  ```
- Unions and string-literal field types are supported (e.g., `"esm" | "cjs" | str`).
- Per-field validation (at declaration) checks that provided properties match field types (shallow).
- `mbool` accepts `true`, `false`, and `maybe`.
- Commented lines are ignored by validators (// and /* ... */).

Examples:
```ts
let ok1::Product = { id: 1, name: "Laptop", price: 999.99, inStock: true, module: "cjs" };
let ok2::Product = { id: 2, name: "Mouse", price: 29.99, inStock: maybe };
let bad1::Product = { id: 3, name: "Cable", price: "9.99", inStock: true }; // error
let bad2::Product = { id: 4, name: "Hub", price: 19.99, inStock: true, module: "commonjs" }; // error
```

## Classes

Class identifiers can be used as types.

```ts
class Counter {
  constructor(initial::num) {
    this.count::num = initial
  }
}

let c::Counter = new Counter(2)
```

## Function Parameters and Defaults

- Annotate parameters with `::`.
- Default values are supported; the default literal is not part of the type.

```ts
func Main(x::num = 3) { spec.log(x) }
```

## Type Conformance

Assignments must respect declared types. The compiler will report type mismatch errors with file:line:col and a code frame.
