import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'
let person = "Manuel";
let age = 15;
const age2 = "This is an string";

function Greet(person) {
  spec.log("Hola " + person + "!");
}
Greet(person);