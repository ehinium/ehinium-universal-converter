import { parseCurrencies } from "./currencyParser";

const sampleText = `
$12.99
€20
£15
USD 1,299.99
1,299.99 USD
AED 79.99
79.99 AED
TRY 1.299,99
1.299,99 TRY
₹5,499
5,499 INR
`;

const results = parseCurrencies(sampleText);

console.log(JSON.stringify(results, null, 2));
