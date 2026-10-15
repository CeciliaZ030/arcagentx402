import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSeller, GATEWAY_MAINNETS, gatewayExtraNetworks, type SellerConfig } from "../src/index.js";

const ARC = "eip155:5042";
const BASE = "eip155:8453";
const POLYGON = "eip155:137";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const PAY_TO = "0x33b37c6d7a98b58da3Ccb3F36A4b578053d0Ea74";
const CIRCLE = "https://circle.test";
const COINBASE = "https://coinbase.test";
const GATEWAY_WALLET = "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE";
const decode = (h: string | null) => JSON.parse(Buffer.from(h!, "base64").toString("utf8"));
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

// Circle's Gateway facilitator lists all twelve chains; Coinbase's lists Base and Solana, and here Polygon too,
// as a facilitator might one day: Polygon's Gateway payments must still go to Circle, the only one that can settle them.
const calls: Array<{ by: string; path: string; network: string }> = [];
beforeAll(() => {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const by = url.startsWith(CIRCLE) ? "circle" : url.startsWith(COINBASE) ? "coinbase" : null;
    if (!by) return real(input, init);
    if (url.endsWith("/supported")) {
      const kinds =
        by === "circle"
          ? Object.entries(GATEWAY_MAINNETS).map(([network, c]) => ({ x402Version: 2, scheme: "exact", network, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET, assets: [{ symbol: "USDC", address: c.usdc, decimals: 6 }] } }))
          : [BASE, POLYGON].map((network) => ({ x402Version: 2, scheme: "exact", network })).concat([{ x402Version: 2, scheme: "exact", network: SOLANA, extra: { feePayer: "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM" } } as never]);
      return Response.json({ kinds, extensions: [], signers: {} });
    }
    const body = JSON.parse(String(init!.body));
    const network = body.paymentRequirements.network;
    calls.push({ by, path: new URL(url).pathname, network });
    if (url.endsWith("/verify")) return Response.json({ isValid: true, payer: "0x000000000000000000000000000000000000bEEF" });
    return Response.json({ success: true, transaction: "3faa5635-789f-45c0-b44a-aef1df26c6b8", network, payer: "0x000000000000000000000000000000000000bEEF" });
  });
});
afterAll(() => void vi.unstubAllGlobals());

const config: SellerConfig = {
  sellerAddress: PAY_TO,
  network: "arc",
  facilitatorUrl: CIRCLE,
  gatewayNetworks: "all",
  discovery: { payTo: PAY_TO, facilitatorUrl: COINBASE, minPrice: "$0.001" },
  solana: { payTo: "26SsHut3dRbK9cWUJcrMfkKn3TKXSFMw61zyqm6tgWjK", minPrice: "$0.001" },
};

function world(cfg: SellerConfig = config) {
  const seller = createSeller(cfg);
  seller.route("GET /v1/paid/fees/forecast", "$0.001", { description: "Base fee now and next block" });
  const app = new Hono();
  app.use("*", seller.middleware());
  app.get("/v1/paid/fees/forecast", (c) => c.json({ baseFeeGwei: 20 }));
  return app;
}

describe("Circle Gateway on every chain Circle settles", () => {
  it("asks for the same price through Gateway on Arc and ten more chains; Base stays with the rail that has it", async () => {
    const res = await world().request("http://api.test/v1/paid/fees/forecast", { headers: { accept: "application/json" } });
    expect(res.status).toBe(402);
    const accepts = decode(res.headers.get("PAYMENT-REQUIRED")).accepts as Array<{ network: string; amount: string; asset: string; payTo: string; extra?: { name?: string; verifyingContract?: string } }>;
    const gateway = accepts.filter((a) => a.extra?.name === "GatewayWalletBatched");
    expect(gateway.map((a) => a.network)).toEqual([ARC, ...Object.keys(GATEWAY_MAINNETS).filter((n) => n !== ARC && n !== BASE)]);
    for (const a of gateway) expect(a, a.network).toMatchObject({ amount: "1000", payTo: PAY_TO, asset: GATEWAY_MAINNETS[a.network]!.usdc, extra: { verifyingContract: GATEWAY_WALLET } });
    // Base and Solana as before: a plain transfer, settled and catalogued by Coinbase's facilitator.
    expect(accepts.filter((a) => a.extra?.name !== "GatewayWalletBatched").map((a) => a.network)).toEqual([BASE, SOLANA]);
  });

  it("sends a payment on Polygon to Circle's facilitator, even when another facilitator also lists Polygon", async () => {
    calls.length = 0;
    const app = world();
    const first = await app.request("http://api.test/v1/paid/fees/forecast", { headers: { accept: "application/json" } });
    const required = decode(first.headers.get("PAYMENT-REQUIRED"));
    const onPolygon = required.accepts.find((a: { network: string }) => a.network === POLYGON);
    const payment = { x402Version: 2, resource: required.resource, accepted: onPolygon, payload: { authorization: { from: "0x000000000000000000000000000000000000bEEF", to: PAY_TO, value: "1000", validAfter: "0", validBefore: "9999999999", nonce: `0x${"11".repeat(32)}` }, signature: `0x${"22".repeat(65)}` } };
    const paid = await app.request("http://api.test/v1/paid/fees/forecast", { headers: { accept: "application/json", "PAYMENT-SIGNATURE": b64(payment) } });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ baseFeeGwei: 20 });
    expect(calls).toEqual([
      { by: "circle", path: "/v1/x402/verify", network: POLYGON },
      { by: "circle", path: "/v1/x402/settle", network: POLYGON },
    ]);
  });

  it("takes only chains Circle settles, never one another rail has, and only with Gateway on mainnet", () => {
    expect(gatewayExtraNetworks(config)).toHaveLength(10);
    expect(gatewayExtraNetworks({ ...config, discovery: undefined } as SellerConfig)).toContain(BASE);
    expect(gatewayExtraNetworks({ ...config, gatewayNetworks: [POLYGON, ARC, POLYGON] })).toEqual([POLYGON]);
    expect(() => gatewayExtraNetworks({ ...config, gatewayNetworks: ["eip155:56"] })).toThrow(/not a network Circle's Gateway settles on/);
    expect(gatewayExtraNetworks({ ...config, settlement: "direct", facilitatorUrl: "https://ours.test" })).toEqual([]);
    expect(gatewayExtraNetworks({ ...config, network: "arcTestnet" })).toEqual([]);
    expect(gatewayExtraNetworks({ ...config, gatewayNetworks: undefined } as SellerConfig)).toEqual([]);
  });
});
