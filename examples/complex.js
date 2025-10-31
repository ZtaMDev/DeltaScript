import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'
// complex.sp - demo avanzado corregido (versión robusta)
// variables y tipos
let username = "Manuel";
let score = 42;
const MAX_SCORE = 100;
let flags = [true, false, (Math.random() < 0.5)];
let cfg = { debug: true, version: "0.1" };
let trust = (Math.random() < 0.5);
// reasignaciones y mut/inmut
username = "Manuel R.";
score = 50;
/* inmut username */ // convierte a const a partir de aquí

// array / objeto
flags = [false, true, (Math.random() < 0.5)];
cfg = { debug: false, files: ["a","b"] };

// funciones y call
function Greet(person) {
  spec.log("Hola " + person + "!");
  return "greeted " + person;
}

function Sum(a, b) {
  return a + b;
}

// usar
Greet(username);
spec.log("Suma:", Sum(3,4));

// clase con inicializador + métodos
class Counter {
  constructor(initial) {
    this.count = initial;
  }
  inc() {
    this.count = this.count + 1;
  }
  add(n) {
    this.count = this.count + n;
  }
}

const c = new Counter(2);
c.inc();
c.add(5);
spec.log("Counter:", c.count);

// bucles
let i = 0;
for (i = 0; i < 3; i = i + 1) {
  spec.log("for i:", i);
}

let w = 0;
while (w < 2) {
  spec.log("while w:", w);
w = w + 1;
}

// if / elif / else (usamos if/else-if)
let opt = "B";
if (opt === "A") {
  spec.log("Option A");
} else if (opt === "B") {
  spec.log("Option B");
} else {
  spec.log("Default");
}

// try/catch/finally
try {
  if (score > MAX_SCORE) {
    throw new Error("Score too big");
  }
} catch (err) {
  spec.log("Error capturado:", err.message);
} finally {
  spec.log("Finally runs");
}

// uso de interfaces (meta)
let p = { name: "Luisa", age: 21, tags: ["dev","student"], meta: { verified: true } };

