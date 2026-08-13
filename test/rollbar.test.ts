import { describe, expect, it, vi } from "vitest";

import { formatResult, RollbarClient } from "../src/rollbar.js";

const env = {
  ROLLBAR_PROD_ACCESS_TOKEN: "prod-token",
  ROLLBAR_QA_ACCESS_TOKEN: "qa-token",
};

describe("RollbarClient", () => {
  it("lists configured credential environments without tokens", async () => {
    const client = new RollbarClient({ env });

    await expect(client.listEnvironments()).resolves.toEqual(["prod", "qa"]);
  });

  it("discovers environments from ROLLBAR_ACCESS_TOKENS JSON", async () => {
    const client = new RollbarClient({
      env: {
        ROLLBAR_ACCESS_TOKENS: JSON.stringify({
          QA: "qa-json-token",
          prod: "prod-json-token",
        }),
      },
    });

    await expect(client.listEnvironments()).resolves.toEqual(["prod", "qa"]);
  });

  it("lets per-environment variables override ROLLBAR_ACCESS_TOKENS", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true })),
    );
    const client = new RollbarClient({
      env: {
        ROLLBAR_ACCESS_TOKENS: JSON.stringify({
          qa: "json-token",
          staging: "staging-json-token",
        }),
        ROLLBAR_QA_ACCESS_TOKEN: "env-token",
      },
      fetch: fetchMock,
    });

    await expect(client.listEnvironments()).resolves.toEqual(["qa", "staging"]);
    await expect(client.get("/api/1/items", "qa")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "X-Rollbar-Access-Token": "env-token" },
    });
  });

  it("uses JSON tokens for environments without a dedicated variable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true })),
    );
    const client = new RollbarClient({
      env: {
        ROLLBAR_ACCESS_TOKENS: JSON.stringify({ staging: "staging-token" }),
      },
      fetch: fetchMock,
    });

    await expect(client.get("/api/1/items", "staging")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "X-Rollbar-Access-Token": "staging-token" },
    });
  });

  it("rejects malformed ROLLBAR_ACCESS_TOKENS without exposing secrets", async () => {
    const client = new RollbarClient({
      env: { ROLLBAR_ACCESS_TOKENS: "not-json" },
    });

    await expect(client.listEnvironments()).rejects.toThrow(
      "must be a JSON object",
    );
    await expect(
      new RollbarClient({
        env: { ROLLBAR_ACCESS_TOKENS: JSON.stringify({ prod: "" }) },
      }).listEnvironments(),
    ).rejects.toThrow("must be a non-empty string");
    await expect(
      new RollbarClient({
        env: { ROLLBAR_ACCESS_TOKENS: JSON.stringify({ "prod-west": "token" }) },
      }).listEnvironments(),
    ).rejects.toThrow("invalid environment name");
  });

  it("ignores empty or unexpanded ROLLBAR_ACCESS_TOKENS placeholders", async () => {
    await expect(
      new RollbarClient({
        env: {
          ROLLBAR_ACCESS_TOKENS: "${ROLLBAR_ACCESS_TOKENS}",
          ROLLBAR_PROD_ACCESS_TOKEN: "prod-token",
          ROLLBAR_QA_ACCESS_TOKEN: "${ROLLBAR_QA_ACCESS_TOKEN}",
        },
      }).listEnvironments(),
    ).resolves.toEqual(["prod"]);
    await expect(
      new RollbarClient({ env: { ROLLBAR_ACCESS_TOKENS: "  " } }).listEnvironments(),
    ).resolves.toEqual([]);
  });

  it("constructs authenticated GET requests and repeated query parameters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ result: { id: 123 } })),
    );
    const client = new RollbarClient({ env, fetch: fetchMock });

    await expect(
      client.get("/api/1/items?ignored=yes", "qa", {
        ignored: "no",
        level: ["error", "critical"],
        page: 2,
      }),
    ).resolves.toEqual({ result: { id: 123 } });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.rollbar.com/api/1/items?ignored=no&level=error&level=critical&page=2",
    );
    expect(init).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "X-Rollbar-Access-Token": "qa-token",
      },
    });
  });

  it("rejects absolute and protocol-relative API paths", async () => {
    const client = new RollbarClient({ env });

    await expect(client.get("https://evil.example/api", "prod")).rejects.toThrow(
      "must begin with /",
    );
    await expect(client.get("//evil.example/api", "prod")).rejects.toThrow(
      "must be relative",
    );
  });

  it("follows same-origin redirects without forwarding tokens elsewhere", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "/api/1/items?page=2" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ page: 2 })));
    const client = new RollbarClient({ env, fetch: fetchMock });

    await expect(client.get("/api/1/items", "prod")).resolves.toEqual({
      page: 2,
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://api.rollbar.com/api/1/items?page=2",
    );

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example/steal" },
      }),
    );
    await expect(client.get("/api/1/items", "prod")).rejects.toThrow(
      "outside the configured origin",
    );
  });

  it("requires a configured token and an HTTPS base URL", async () => {
    await expect(
      new RollbarClient({ env: {} }).get("/api/1/items", "prod"),
    ).rejects.toThrow("ROLLBAR_PROD_ACCESS_TOKEN");
    await expect(
      new RollbarClient({ env: {} }).get("/api/1/items", "prod"),
    ).rejects.toThrow("ROLLBAR_ACCESS_TOKENS");
    await expect(
      new RollbarClient({
        env: {
          ROLLBAR_PROD_ACCESS_TOKEN: "token",
          ROLLBAR_API_BASE_URL: "http://api.rollbar.com",
        },
      }).get("/api/1/items", "prod"),
    ).rejects.toThrow("must use HTTPS");
  });

  it("surfaces Rollbar API errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ err: 1, message: "Not found" }), {
        status: 404,
        statusText: "Not Found",
      }),
    );

    await expect(
      new RollbarClient({ env, fetch: fetchMock }).get(
        "/api/1/item/unknown",
        "prod",
      ),
    ).rejects.toThrow('Rollbar API 404 Not Found: {\n  "err": 1');
  });

  it("truncates large output without producing invalid UTF-8", () => {
    const output = formatResult({ value: "🙂".repeat(30_000) });

    expect(output).toContain("[Output truncated:");
    expect(output).not.toContain("�");
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(50 * 1024);
    expect(output.split("\n").length).toBeLessThanOrEqual(2_000);
  });

  it("keeps line-heavy output within 2,000 lines", () => {
    const output = formatResult(Array.from({ length: 3_000 }, (_, id) => ({
      id,
    })));

    expect(output).toContain("[Output truncated:");
    expect(output.split("\n").length).toBeLessThanOrEqual(2_000);
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(50 * 1024);
  });
});
