import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'
// Arrays tipados
let numbers = [1, 2, 3];
let stringi = "fuckit"
let strings = [stringi, "b", "c"]; 
let objs = {}
let objects = [objs, {}, {}];
let mboools = [true, false, (Math.random() < 0.5)];
let mixed = [1, "a", true];

// Asignaciones válidas
numbers = [4, 5, 6];
mixed = numbers;

let comp = { useIt: (Math.random() < 0.5) }
let mixted = ["string",4, comp]