import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RollbarService } from "../src/rollbar.js";
import { createServer } from "../src/server.js";

describe("Rollbar MCP server", () => {
  let client: Client | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connect(service: RollbarService): Promise<Client> {
    server = createServer(service);
    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  it("identifies itself as rollbar version 0.1.0", async () => {
    const connected = await connect({
      listEnvironments: vi.fn(),
      get: vi.fn(),
    });

    expect(connected.getServerVersion()).toMatchObject({
      name: "rollbar",
      version: "0.1.0",
    });
  });

  it("exposes exactly two read-only tools", async () => {
    const connected = await connect({
      listEnvironments: vi.fn(),
      get: vi.fn(),
    });

    const { tools } = await connected.listTools();

    expect(tools.map(({ name }) => name)).toEqual([
      "rollbar_list_environments",
      "rollbar_get",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
  });

  it("lists environments without exposing service details", async () => {
    const listEnvironments = vi.fn().mockResolvedValue(["prod", "staging"]);
    const connected = await connect({
      listEnvironments,
      get: vi.fn(),
    });

    const result = await connected.callTool({
      name: "rollbar_list_environments",
      arguments: {},
    });

    expect(result.content).toEqual([{
      type: "text",
      text: JSON.stringify({
        defaultEnvironment: "prod",
        environments: ["prod", "staging"],
      }, null, 2),
    }]);
  });

  it("routes GET requests and supplies the default environment", async () => {
    const get = vi.fn().mockResolvedValue({ result: { id: 123 } });
    const connected = await connect({
      listEnvironments: vi.fn(),
      get,
    });

    const result = await connected.callTool({
      name: "rollbar_get",
      arguments: {
        path: "/api/1/items",
        query: { status: "active", level: ["error", "critical"] },
      },
    });

    expect(get).toHaveBeenCalledWith("/api/1/items", "prod", {
      status: "active",
      level: ["error", "critical"],
    });
    expect(result.content).toEqual([{
      type: "text",
      text: JSON.stringify({ result: { id: 123 } }, null, 2),
    }]);
  });

  it("rejects invalid arguments before invoking the service", async () => {
    const get = vi.fn();
    const connected = await connect({
      listEnvironments: vi.fn(),
      get,
    });

    const result = await connected.callTool({
      name: "rollbar_get",
      arguments: { path: "/api/1/items", query: { page: { invalid: true } } },
    });

    expect(result.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
});
