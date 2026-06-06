export type CurrencyMatch = {
  raw: string;
  amount: number;
  currency: string;
};

const currencyPatterns = [
  {
    currency: "USD",
    regex: /\$\s?([\d,.]+)/g,
  },
  {
    currency: "EUR",
    regex: /€\s?([\d,.]+)/g,
  },
  {
    currency: "GBP",
    regex: /£\s?([\d,.]+)/g,
  },
];

export function parseCurrencies(text: string): CurrencyMatch[] {
  const matches: CurrencyMatch[] = [];

  for (const pattern of currencyPatterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const raw = match[0];
      const amountText = match[1].replace(/,/g, "");
      const amount = Number(amountText);

      if (!Number.isNaN(amount)) {
        matches.push({
          raw,
          amount,
          currency: pattern.currency,
        });
      }
    }
  }

  return matches;
}
