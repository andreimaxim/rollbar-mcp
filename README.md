# Rollbar MCP

A focused, read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for Rollbar investigations. It works with Amp, Claude Code, Codex, and other clients that support local stdio MCP servers.

## Tools

The server deliberately exposes only two tools:

- `rollbar_list_environments` lists configured credential environments without exposing their tokens.
- `rollbar_get` performs one authenticated `GET` request to a Rollbar API path.

It does not expose writes, `POST` requests, or RQL. Tool output is limited to 2,000 lines or 50 KiB. Request paths and redirects remain confined to the configured HTTPS origin so access tokens are never forwarded elsewhere.

## Requirements

- Node.js 20 or newer
- A Rollbar Project Access Token with only the `read` scope for each credential environment

Configure the process that runs your MCP client with environment variables named `ROLLBAR_<ENVIRONMENT>_ACCESS_TOKEN`:

```bash
export ROLLBAR_QA_ACCESS_TOKEN="your-qa-read-token"
export ROLLBAR_STAGING_ACCESS_TOKEN="your-staging-read-token"
export ROLLBAR_PROD_ACCESS_TOKEN="your-prod-read-token"
```

The server discovers these variables and exposes their lowercased environment segments through `rollbar_list_environments`. Requests default to `prod` when no credential environment is specified. Treat all access tokens as secrets and do not commit them to MCP configuration files.

The Rollbar API base URL defaults to `https://api.rollbar.com`. Custom or proxied API endpoints can override it with `ROLLBAR_API_BASE_URL`; the value must use HTTPS and cannot include credentials, a query string, or a fragment.

Run the published package through an MCP client:

```bash
npx -y @andreimaxim/rollbar-mcp
```

It communicates over standard input and output, so running it directly appears to do nothing while it waits for an MCP client.

## Amp

The distributable [`using-rollbar` skill](skill/using-rollbar/SKILL.md) includes the MCP launch configuration and exposes only `rollbar_list_environments` and `rollbar_get`. Install that directory as a project, personal, or workspace skill.

For a project skill, copy it into the repository:

```text
.agents/skills/using-rollbar/SKILL.md
```

For an orb, add the required `ROLLBAR_*_ACCESS_TOKEN` values under personal, project, or workspace **Secrets & Env Vars**. The included skill forwards the common `qa`, `staging`, and `prod` profiles; add another environment-variable reference to its `mcpServers.rollbar.env` map if you use a different profile name. Amp starts the MCP server in the orb when it discovers the skill and reveals its tools only when the skill loads.

The previous `amp.rollbar.*` plugin settings are no longer read; the portable MCP server uses environment variables in every harness.

## Claude Code

Register the same stdio server at user scope:

```bash
claude mcp add --scope user --transport stdio rollbar -- \
  npx -y @andreimaxim/rollbar-mcp
```

Start Claude Code with the desired `ROLLBAR_*_ACCESS_TOKEN` variables available in its environment. For team distribution, put the equivalent server entry in the project's `.mcp.json` and keep credentials as environment-variable references.

## Codex

Add this entry to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.rollbar]
command = "npx"
args = ["-y", "@andreimaxim/rollbar-mcp"]
env_vars = [
  "ROLLBAR_QA_ACCESS_TOKEN",
  "ROLLBAR_STAGING_ACCESS_TOKEN",
  "ROLLBAR_PROD_ACCESS_TOKEN",
  "ROLLBAR_API_BASE_URL",
]
enabled_tools = ["rollbar_list_environments", "rollbar_get"]
```

Forward only the credential environments you use. The `env_vars` list forwards existing variables without placing their values in the configuration file.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

Repository layout:

- `src/rollbar.ts` contains credential discovery, request validation, the Rollbar HTTP client, redirect confinement, and bounded output formatting.
- `src/server.ts` registers the MCP tools and their read-only annotations.
- `src/index.ts` starts the stdio server.
- `skill/using-rollbar/SKILL.md` contains the Amp skill and its MCP launch configuration.
- `test/` contains HTTP-client and protocol-level integration tests.
