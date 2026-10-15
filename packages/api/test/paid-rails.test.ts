import { describe, expect, it } from "vitest";
import { gatewayNetworksFromEnv, railOf } from "../src/paid.js";

const ARC = "eip155:5042";

describe("how /status names the rail a payment came by", () => {
  it("keeps Arc's own rail, and tells Base's plain transfer from Gateway on the other chains", () => {
    expect(railOf(ARC, ARC, "gateway")).toBe("gateway");
    expect(railOf(ARC, ARC, "direct")).toBe("direct");
    expect(railOf("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", ARC, "gateway")).toBe("solana");
    expect(railOf("eip155:8453", ARC, "gateway")).toBe("base");
    expect(railOf("eip155:8453", ARC, "direct")).toBe("base");
    expect(railOf("eip155:137", ARC, "gateway")).toBe("gateway");
    expect(railOf("eip155:42161", ARC, "gateway")).toBe("gateway");
  });
});

describe("GATEWAY_NETWORKS", () => {
  it("is every chain Circle settles unless told otherwise", () => {
    expect(gatewayNetworksFromEnv(undefined)).toBe("all");
    expect(gatewayNetworksFromEnv("")).toBe("all");
    expect(gatewayNetworksFromEnv("all")).toBe("all");
    expect(gatewayNetworksFromEnv("off")).toBeUndefined();
    expect(gatewayNetworksFromEnv("arc")).toBeUndefined();
    expect(gatewayNetworksFromEnv(" eip155:137, eip155:42161 ")).toEqual(["eip155:137", "eip155:42161"]);
  });
});
