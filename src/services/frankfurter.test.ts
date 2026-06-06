async function run() {
  const response = await fetch("https://api.frankfurter.dev/v2/rates?base=USD");

  console.log("status:", response.status);

  const text = await response.text();

  console.log(text);
}

run();