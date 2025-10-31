import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'
// complex-demo.sp - Demo completo de Spark Script


// ========== DECLARACIONES BÁSICAS ==========
let username = "Carlos";
let score = 95;
const MAX_SCORE = 100;
let isActive = (Math.random() < 0.5);
let flags = [true, false, (Math.random() < 0.5)];
let config = { debug: true, version: "1.0.0" };

// ========== ARRAYS TIPADOS ==========
let names = ["Ana", "Carlos", "Diana", "Eduardo"];
let numbers = [1, 2, 3, 4, 5];
let booleans = [true, false, (Math.random() < 0.5)];
let objects = [{ id: 1 }, { id: 2 }, { id: 3 }];

// Arrays con variables
let tempName = "Temporal";
let mixedNames = [tempName, "Fixed", "Static"];
let tempObj = { temp: true };
let objList = [tempObj, { permanent: true }, { mixed: (Math.random() < 0.5) }];

// ========== INTERFACES Y OBJETOS ==========
let person1 = {
  name: "María",
  age: 28,
  tags: ["developer", "designer"],
  meta: { verified: true, premium: false },
  scores: [85, 92, 78]
};

let person2 = {
  name: "Pedro", 
  age: 32,
  tags: ["manager", "lead"],
  meta: { verified: true, premium: true },
  scores: [95, 88, 91]
};

let product1 = {
  id: 1,
  name: "Laptop",
  price: 999.99,
  inStock: true
};

let product2 = {
  id: 2,
  name: "Mouse",
  price: 29.99,
  inStock: (Math.random() < 0.5)
};

// ========== MUT/INMUT ==========
username = "Carlos García";
score = 85;
/* inmut username */ // convierte a const a partir de aquí

// username = "Error"; // Esto daría error después de inmut

isActive = true;
isActive = false;

// ========== FUNCIONES ==========
function greet(person) {
  spec.log("¡Hola " + person + "!");
  return "saludo realizado";
}

function calculateTotal(prices) {
  let total = 0;
  let i = 0;
  for (i = 0; i < prices.length; i = i + 1) {
total = total + prices[i];
  }
  return total;
}

function processPerson(p) {
  spec.log("Procesando: " + p.name);
  spec.log("Edad: " + p.age);
  spec.log("Etiquetas: " + p.tags.join(", "));
  return p.name + " procesado";
}

function createProduct(id, name, price) {
  return {
    id: id,
    name: name,
    price: price,
    inStock: (Math.random() < 0.5)
  };
}

// ========== USO DE FUNCIONES ==========
greet(username);
let total = calculateTotal([10, 20, 30, 40]);
//let total = calculateTotal([10, 20, 30, 40]);
spec.log("Total calculado:", total);

let result = processPerson(person1);
spec.log("Resultado:", result);

// ========== CALL (UNA SOLA VEZ) ==========
greet("Usuario Único"); // Esta función solo se puede llamar una vez

// ========== CLASES ==========
class Counter {
  constructor(initial) {
    this.count = initial;
  }
  
  increment() {
    this.count = this.count + 1;
  }
  
  add(value) {
    this.count = this.count + value;
  }
  
  reset() {
    this.count = 0;
  }
}

class ShoppingCart {
  constructor() {
    this.items = [];
    this.total = 0;
  }
  
  addItem(product) {
    this.items.push(product);
    this.total = this.total + product.price;
  }
  
  getItemCount() {
    return this.items.length;
  }
}

// ========== USO DE CLASES ==========
let counter = new Counter(5);
counter.increment();
counter.add(3);
spec.log("Contador:", counter.count);

let cart = new ShoppingCart();
cart.addItem(product1);
cart.addItem(product2);
spec.log("Carrito - Items:", cart.getItemCount(), "Total:", cart.total);

// ========== BUCLES ==========
spec.log("=== BUCLE FOR ===");
let i = 0;
for (i = 0; i < 3; i = i + 1) {
  spec.log("Iteración for:", i);
}

spec.log("=== BUCLE WHILE ===");
let j = 0;
while (j < 2) {
  spec.log("Iteración while:", j);
j = j + 1;
}

spec.log("=== RECORRER ARRAY ===");
let k = 0;
for (k = 0; k < names.length; k = k + 1) {
  spec.log("Nombre", k, ":", names[k]);
}

// ========== CONDICIONALES ==========
let userType = "premium";

if (userType === "admin") {
  spec.log("Acceso total administrativo");
} else if (userType === "premium") {
  spec.log("Acceso premium habilitado");
} else if (userType === "basic") {
  spec.log("Acceso básico");
} else {
  spec.log("Tipo de usuario desconocido");
}

// ========== MANEJO DE ERRORES ==========
try {
  if (score > MAX_SCORE) {
    throw new Error("Puntuación excede el máximo permitido");
  }
  
  let testArray = [1, 2, 3];
  // testArray = ["a", "b", "c"]; // Esto causaría error de tipos
  
  spec.log("Todo funcionó correctamente");
  
} catch (err) {
  spec.log("Error capturado:", err.message);
} finally {
  spec.log("Bloque finally ejecutado");
}

// ========== OPERACIONES CON ARRAYS TIPADOS ==========
let filteredNames = [];
let m = 0;
for (m = 0; m < names.length; m = m + 1) {
  if (names[m].length > 4) {
    filteredNames.push(names[m]);
  }
}
spec.log("Nombres filtrados:", filteredNames);

// ========== OBJETOS COMPLEJOS ==========
let inventory = [
  product1,
  product2,
  createProduct(3, "Teclado", 79.99),
  createProduct(4, "Monitor", 299.99)
];

spec.log("=== INVENTARIO ===");
let n = 0;
for (n = 0; n < inventory.length; n = n + 1) {
  let product = inventory[n];
  spec.log("Producto:", product.name, "- Precio: $" + product.price);
}

// ========== USO AVANZADO DE INTERFACES ==========
let team = [person1, person2];

function findPersonByName(people, searchName) {
  let p = 0;
  for (p = 0; p < people.length; p = p + 1) {
    if (people[p].name === searchName) {
      return people[p];
    }
  }
  return null;
}

let foundPerson = findPersonByName(team, "María");
if (foundPerson !== null) {
  spec.log("Persona encontrada:", foundPerson.name, "- Edad:", foundPerson.age);
}

// ========== EJEMPLO DE MAYBE ==========
spec.log("=== EJEMPLOS MAYBE ===");
let randomFlag = (Math.random() < 0.5);
spec.log("Valor aleatorio ((Math.random() < 0.5)):", randomFlag);

if (randomFlag === true) {
  spec.log("El (Math.random() < 0.5) resultó ser true");
} else if (randomFlag === false) {
  spec.log("El (Math.random() < 0.5) resultó ser false");
} else {
  spec.log("El (Math.random() < 0.5) está en estado indeterminado (pero en JS será true o false)");
}

// ========== FINAL ==========
spec.log("=== ESTADO FINAL ===");
spec.log("Usuario:", username);
spec.log("Puntuación:", score);
spec.log("Activo:", isActive);
spec.log("Total carrito:", cart.total);
spec.log("Contador final:", counter.count);

spec.log("Final Message to use PE.")