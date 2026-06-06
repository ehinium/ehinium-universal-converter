import { parseCurrencies } from "../utils/currencyParser";

const text = document.body.innerText;
const matches = parseCurrencies(text);

console.log("Ehinium Universal Converter content script loaded.");
console.log("Currency matches:", matches);