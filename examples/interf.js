import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'

let p = { name: "Luisa", age: 21, tags: ["dev","student"], meta: { verified: true } };

async function main() {
  spec.log(p);
}