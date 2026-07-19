import { fetchEhiniumIranianRate } from "./ehiniumIranianRates";

function expect(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(description);
}

function expectEqual<T>(actual: T, expected: T, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

async function expectRejects(
  action: () => Promise<unknown>,
  expectedMessage: string,
  description: string,
  forbiddenText?: string
): Promise<void> {
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(caught instanceof Error, `${description}: expected an Error`);
  expectEqual(caught.message, expectedMessage, description);

  if (forbiddenText) {
    expect(
      !caught.message.includes(forbiddenText),
      `${description}: error message exposed forbidden text`
    );
  }
}

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  } as Response;
}

function mockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch {
  return handler as typeof fetch;
}

const apiUrl = "https://ehinium-rates-api.ehinium.workers.dev";
const token = "test-extension-token";
const validResponse = {
  version: 1,
  unit: "IRT",
  updatedAt: "2026-07-19T12:00:00Z",
  sourceUpdatedAt: "2026-07-19T11:59:00Z",
  rates: {
    USD: {
      buy: 193400,
      sell: 193500,
    },
  },
};

const calls: FetchCall[] = [];
const successfulFetch = mockFetch(async (input, init) => {
  calls.push({ input, init });
  return jsonResponse(validResponse);
});
const result = await fetchEhiniumIranianRate({
  apiUrl,
  token,
  fetchImpl: successfulFetch,
});

expectEqual(
  result,
  {
    unit: "IRT",
    usdSellIrt: 193500,
    updatedAt: "2026-07-19T12:00:00Z",
    sourceUpdatedAt: "2026-07-19T11:59:00Z",
    provider: "ehinium",
  },
  "successful normalized bridge response"
);
expectEqual(Object.keys(result).sort(), [
  "provider",
  "sourceUpdatedAt",
  "unit",
  "updatedAt",
  "usdSellIrt",
], "normalized response contains only approved fields");
expectEqual(calls.length, 1, "successful request count");
expectEqual(String(calls[0].input), apiUrl, "request URL");
expectEqual(calls[0].init?.method, "GET", "request method");
const requestHeaders = new Headers(calls[0].init?.headers);
expectEqual(
  requestHeaders.get("Authorization"),
  `Bearer ${token}`,
  "authorization header"
);
expectEqual(requestHeaders.get("Accept"), "application/json", "accept header");
expectEqual(result.usdSellIrt, validResponse.rates.USD.sell, "sell rate is used");
expect(
  result.usdSellIrt !== validResponse.rates.USD.buy,
  "buy rate must be ignored"
);

let missingInputFetchCalls = 0;
const missingInputFetch = mockFetch(async () => {
  missingInputFetchCalls += 1;
  return jsonResponse(validResponse);
});
await expectRejects(
  () => fetchEhiniumIranianRate({ apiUrl, token: "   ", fetchImpl: missingInputFetch }),
  "Ehinium Iranian rates token is missing",
  "missing token"
);
await expectRejects(
  () => fetchEhiniumIranianRate({ apiUrl: "  ", token, fetchImpl: missingInputFetch }),
  "Ehinium Iranian rates API URL is missing",
  "missing API URL"
);
expectEqual(missingInputFetchCalls, 0, "missing inputs fail before fetch");

for (const status of [401, 500]) {
  await expectRejects(
    () =>
      fetchEhiniumIranianRate({
        apiUrl,
        token,
        fetchImpl: mockFetch(async () => jsonResponse(validResponse, status)),
      }),
    `Ehinium Iranian rates request failed with status ${status}`,
    `HTTP ${status} failure`,
    token
  );
}

await expectRejects(
  () =>
    fetchEhiniumIranianRate({
      apiUrl,
      token,
      fetchImpl: mockFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("malformed response");
        },
      }) as Response),
    }),
  "Ehinium Iranian rates returned invalid JSON",
  "malformed JSON failure",
  token
);

const invalidResponses: Array<[string, unknown]> = [
  ["missing rates", { ...validResponse, rates: undefined }],
  ["missing USD", { ...validResponse, rates: {} }],
  ["missing sell", { ...validResponse, rates: { USD: { buy: 193400 } } }],
  ["string sell", { ...validResponse, rates: { USD: { sell: "193500" } } }],
  ["zero sell", { ...validResponse, rates: { USD: { sell: 0 } } }],
  ["negative sell", { ...validResponse, rates: { USD: { sell: -1 } } }],
  ["NaN sell", { ...validResponse, rates: { USD: { sell: Number.NaN } } }],
  ["Infinity sell", { ...validResponse, rates: { USD: { sell: Number.POSITIVE_INFINITY } } }],
  ["wrong unit", { ...validResponse, unit: "IRR" }],
  ["empty updatedAt", { ...validResponse, updatedAt: "  " }],
  ["invalid sourceUpdatedAt", { ...validResponse, sourceUpdatedAt: "" }],
  ["numeric sourceUpdatedAt", { ...validResponse, sourceUpdatedAt: 123 }],
];

for (const [description, value] of invalidResponses) {
  await expectRejects(
    () =>
      fetchEhiniumIranianRate({
        apiUrl,
        token,
        fetchImpl: mockFetch(async () => jsonResponse(value)),
      }),
    "Ehinium Iranian rates response is invalid",
    description,
    token
  );
}

const secretToken = "never-expose-this-token";
await expectRejects(
  () =>
    fetchEhiniumIranianRate({
      apiUrl,
      token: secretToken,
      fetchImpl: mockFetch(async () => {
        throw new Error(`network failure for ${secretToken}`);
      }),
    }),
  "Ehinium Iranian rates request failed",
  "network error sanitization",
  secretToken
);
