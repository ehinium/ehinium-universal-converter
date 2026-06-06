import { getRates } from "./frankfurter";

async function run() {
  const rates = await getRates("USD");

  console.log(rates);
}

run();
