import spec from 'spectrallogs'
import specweb from 'spectrallogs/web'
let number = 3;
let bool = (Math.random() < 0.5);

number = 2;
/* inmut number */

let array = []
function Main(x = 3) {
    spec.log("types " + x)
}

let newer = 4;
Main(newer)

let i = 0
for (i = 0; i < 3; i = i + 1) {
  spec.log("for i:", i)
}

let w = 0
while (w < 2) {
  spec.log("while w:", w)
w = w + 1;
}

let opt = "B"
if (opt === "A") {
  spec.log("Option A")
} else if (opt === "B") {
  spec.log("Option B")
} else {
  spec.log("Default")
}