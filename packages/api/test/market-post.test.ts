import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/safe-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/safe-fetch.js")>();
  return { ...actual, safeFetch: vi.fn() };
});

import { documentedPost, NotListable, probe } from "../src/market.js";
import { safeFetch, type Fetched, type SafeFetchOptions } from "../src/safe-fetch.js";

const ROUTE_URL = "https://seller.example/v1/task/build";
const ARC = "eip155:5042";
const PAY_TO = "0x33b37c6d7a98b58da3Ccb3F36A4b578053d0Ea74";
const example = { intent: "Quote only", chainId: 5042 };
const manifest = { paths: { "/v1/task/build": { payment: { endpoint: ROUTE_URL, method: "POST", exampleRequest: example } } } };
const response = (status: number, body = "", headers: Record<string, string> = {}): Fetched => ({ finalUrl: ROUTE_URL, status, headers, body: Buffer.from(body), truncated: false, hops: [] });
const challenge = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: ARC, amount: "10000", payTo: PAY_TO }] })).toString("base64");

afterEach(() => vi.resetAllMocks());

describe("documented body-bound market listings", () => {
  it("requires the manifest to name the exact endpoint and a bounded object example", () => {
    expect(documentedPost(new URL(ROUTE_URL), manifest)).toEqual(example);
    expect(documentedPost(new URL(ROUTE_URL), { paths: { "/v1/task/build": { payment: { ...manifest.paths["/v1/task/build"].payment, endpoint: "https://other.example/charge" } } } })).toBeNull();
    expect(documentedPost(new URL(ROUTE_URL), { paths: { "/v1/task/build": { payment: { endpoint: ROUTE_URL, method: "POST", exampleRequest: { x: "x".repeat(8192) } } } } })).toBeNull();
  });

  it("quotes a documented POST without payment and preserves its body for buyers", async () => {
    vi.mocked(safeFetch).mockImplementation(async (url: string, opts?: SafeFetchOptions) => {
      if (url === ROUTE_URL && opts?.method === "POST") return response(402, "", { "payment-required": challenge });
      if (url === ROUTE_URL) return response(405);
      if (url === "https://seller.example/.well-known/x402") return response(200, JSON.stringify(manifest));
      throw new Error(`unexpected fetch ${url}`);
    });
    const listing = await probe(ROUTE_URL, ARC);
    expect(listing).toMatchObject({ method: "POST", body: example, amountUsdc6: "10000", network: ARC });
    expect(safeFetch).toHaveBeenCalledWith(ROUTE_URL, expect.objectContaining({ method: "POST", body: JSON.stringify(example), maxRedirects: 0 }));
  });

  it("keeps existing GET listings and never POSTs from an unrelated manifest", async () => {
    vi.mocked(safeFetch).mockImplementation(async (url: string) => url === ROUTE_URL
      ? response(402, "", { "payment-required": challenge })
      : response(200, JSON.stringify(manifest)));
    expect(await probe(ROUTE_URL, ARC)).toMatchObject({ method: "GET", body: null });
    expect(vi.mocked(safeFetch).mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(0);

    vi.resetAllMocks();
    vi.mocked(safeFetch).mockImplementation(async (url: string) => url === ROUTE_URL
      ? response(405)
      : response(200, JSON.stringify({ paths: { "/other": manifest.paths["/v1/task/build"] } })));
    await expect(probe(ROUTE_URL, ARC)).rejects.toThrow(NotListable);
    expect(vi.mocked(safeFetch).mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(0);
  });
});
