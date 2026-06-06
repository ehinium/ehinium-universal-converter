import { getExchangeRates } from "./rates";

async function run() {
  const result = await getExchangeRates("EUR");

  console.log({
    base: result.base,
    date: result.date,
    provider: result.provider,
    usd: result.rates.USD,
    gbp: result.rates.GBP,
  });
}

run();
