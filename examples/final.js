import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'
// interface.sp

// variables y tipos
let name = "Juan";
let age = 30;
let isActive = (Math.random() < 0.5);
let scores = [95, 87, 92];
let person = {
  name: "Maria",
  age: 25,
  tags: ["developer", "designer"],
  meta: { verified: true }
};

// arrays tipados
let names = ["Ana", "Carlos", "Diana"];
let mixedArray = [1, "hello", (Math.random() < 0.5)]; // array mixto

// reasignaciones y mut/inmut
name = "Juanito";
age = 31;
/* inmut name */ // a partir de aquí name es inmutable

// funciones
function greet(personName) {
  spec.log("Hello, " + personName + "!");
  return "greeted " + personName;
}

function add(a, b) {
  return a + b;
}

// usar call para funciones que solo deben llamarse una vez
greet("World");

// clase
class Calculator {
  constructor(initial) {
    this.value = initial;
  }

  add(x) {
    this.value = this.value + x;
  }

  multiply(x) {
    this.value = this.value * x;
  }
}

const calc = new Calculator(10);
calc.add(5);
calc.multiply(2);
spec.log("Calculator value:", calc.value);

// bucles
let i = 0;
for (i = 0; i < 5; i = i + 1) {
  spec.log("For loop i:", i);
}

let j = 0;
while (j < 3) {
  spec.log("While loop j:", j);
j = j + 1;
}

// if/elif/else
let option = "B";
if (option === "A") {
  spec.log("Option A selected");
} else if (option === "B") {
  spec.log("Option B selected");
} else {
  spec.log("Default option");
}

// try/catch
try {
  if (age < 0) {
    throw new Error("Age cannot be negative");
  }
} catch (err) {
  spec.log("Error caught:", err.message);
} finally {
  spec.log("This always runs");
}

// uso de interfaces en funciones
function registerPerson(p) {
  spec.log("Registering:", p.name);
}

registerPerson(person);

// arrays tipados con variables
let newPerson = { name: "Luis", age: 28, tags: ["engineer"], meta: {} };
let people = [person, newPerson, { name: "Ana", age: 22, tags: [], meta: {} }];
