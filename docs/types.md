# Types Reference

This page summarizes DeltaScript's type system and key rules.

## Primitive Types

- `num`: numeric values (integers and floats)
- `str`: strings
- `bool`: booleans

## Maybe Type

- `mbool`: a tri‑state logical type useful for indeterminate states. At runtime it maps to true/false but conveys intent in annotations.

## Arrays

- Untyped arrays: `arr`
- Typed arrays: `arr<T>`

Examples:
```
let xs::arr = [1, "a", true]
let ys::arr<num> = [1, 2, 3]
let names::arr<str> = ["a", "b"]
```

## Objects

- `obj`: general purpose object/map.

```
let cfg::obj = { debug: true, version: "0.1" }
```

## Interfaces

Interfaces declare object shapes.

```
interface Person {
  name::str;
  age::num;
  tags::arr<str>;
  meta::obj;
}
```

## Classes

Class identifiers can be used as types.

```
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

```
func Main(x::num = 3) { spec.log(x) }
```

## Type Conformance

Assignments must respect declared types. The compiler will report type mismatch errors with file:line:col and a code frame.
