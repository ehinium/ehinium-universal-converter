export async function getRates(baseCurrency: string) {
  const response = await fetch(
    `https://api.frankfurter.app/latest?from=${baseCurrency}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch exchange rates");
  }

  return response.json();
}
