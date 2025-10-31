# Examples

This page links and explains the key examples included in the repository under `./examples`.

> Note: The examples are written in `.ds` and compiled to `.js` via `dsc build`. You can also run a single example directly with `dsc examples/<file>.ds`.

## simple.ds

Basics: variables, default parameters, logging.

```
let number::num = 3
let mgbool::mbool = maybe

number = 2
inmut number

func Main(x::num = 3) {
  spec.log("types ", x)
}

let newer::num = 4
Main(newer)
```

## complex.ds

Functions, classes, control flow, try/catch/finally.

```
func Greet(person::str) {
  spec.log("Hola " + person + "!")
  return "greeted " + person
}

func Sum(a::num, b::num) {
  return a + b
}

Greet("Manuel")
spec.log("Suma:", Sum(3,4))

class Counter {
  constructor(initial::num) { this.count::num = initial }
  inc() { this.count = this.count + 1 }
  add(n::num) { this.count = this.count + n }
}

const c::Counter = new Counter(2)
c.inc(); c.add(5)
spec.log("Counter:", c.count)
```

## complexfinal.ds

Interfaces, arrays, loops, and structured logging throughout a larger sample.

```
interface Person { name::str; age::num; tags::arr<str>; meta::obj }

func processPerson(p::Person) {
  spec.log("Procesando:", p.name)
  return p.name
}

let person::Person = { name: "Luis", age: 28, tags: ["engineer"], meta: {} }
let team::arr<Person> = [person]

spec.log("=== BUCLE FOR ===")
let i::num = 0
for (i = 0; i < 3; i = i + 1) {
  spec.log("Iteración for:", i)
}
```

## Running examples

- Build all: `dsc build`
- Watch: `dsc dev`
- Run single: `dsc examples/simple.ds`
- Force CDN for SpectralLogs: `dsc examples/simple.ds --spectral-cdn`
- Rewrite console to spec: `dsc build --migrate-to-spec`
