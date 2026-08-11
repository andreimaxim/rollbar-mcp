import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  formatResult,
  RollbarClient,
  type RollbarService,
} from "./rollbar.js";

const primitiveQueryValue = z.union([z.string(), z.number(), z.boolean()]);
const queryValue = z.union([primitiveQueryValue, z.array(primitiveQueryValue)]);

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

function textResult(value: Awaited<ReturnType<RollbarService["get"]>>) {
  return {
    content: [{ type: "text" as const, text: formatResult(value) }],
  };
}

export function createServer(
  service: RollbarService = new RollbarClient(),
): McpServer {
  const server = new McpServer({
    name: "rollbar",
    version: "0.1.0",
  });

  server.registerTool(
    "rollbar_list_environments",
    {
      title: "List Rollbar environments",
      description:
        "List configured Rollbar credential environments without exposing their access tokens.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () =>
      textResult({
        defaultEnvironment: "prod",
        environments: await service.listEnvironments(),
      }),
  );

  server.registerTool(
    "rollbar_get",
    {
      title: "Get Rollbar data",
      description:
        "Make one authenticated GET request to a Rollbar API path. This tool is read-only and may truncate large output.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Rollbar API path beginning with /, for example /api/1/items or /api/1/instance/12345",
          ),
        environment: z
          .string()
          .default("prod")
          .describe(
            "Credential environment. Use rollbar_list_environments to discover configured values. Defaults to prod.",
          ),
        query: z
          .record(z.string(), queryValue)
          .optional()
          .describe(
            "Optional query parameters. Array values are encoded as repeated parameters.",
          ),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ path, environment, query }) =>
      textResult(await service.get(path, environment, query)),
  );

  return server;
}
