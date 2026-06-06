import { convertCurrency } from "./currencyConverter";

const rates = {
  USD: 1.08,
  GBP: 0.85,
};

console.log(convertCurrency(108, "USD", "EUR", rates)); // 100
console.log(convertCurrency(85, "GBP", "EUR", rates)); // 100
console.log(convertCurrency(100, "EUR", "EUR", rates)); // 100
