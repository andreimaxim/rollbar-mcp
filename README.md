# Rollbar MCP

A focused, read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for Rollbar investigations. It works with Amp, Claude Code, Codex, Docker sandboxes, and other clients that support local stdio MCP servers.

## Tools

The server deliberately exposes only two tools:

- `rollbar_list_environments` lists configured credential environments without exposing their tokens.
- `rollbar_get` performs one authenticated `GET` request to a Rollbar API path.

It does not expose writes, `POST` requests, or RQL. Tool output is limited to 2,000 lines or 50 KiB. Request paths and redirects remain confined to the configured HTTPS origin so access tokens are never forwarded elsewhere.

## Requirements

- Node.js 20 or newer, or Docker
- A Rollbar Project Access Token with only the `read` scope for each credential environment

Configure credentials with one or both of these mechanisms. Treat all access tokens as secrets and do not commit them to MCP configuration files.

### Per-environment variables

```bash
export ROLLBAR_QA_ACCESS_TOKEN="your-qa-read-token"
export ROLLBAR_STAGING_ACCESS_TOKEN="your-staging-read-token"
export ROLLBAR_PROD_ACCESS_TOKEN="your-prod-read-token"
```

The server discovers variables named `ROLLBAR_<ENVIRONMENT>_ACCESS_TOKEN` and exposes their lowercased environment segments through `rollbar_list_environments`.

### JSON map (one secret, many environments)

Docker catalogs, Amp orbs, and other sandboxes often inject secrets by a fixed name. Put every credential environment in one JSON object:

```bash
export ROLLBAR_ACCESS_TOKENS='{"qa":"your-qa-read-token","staging":"your-staging-read-token","prod":"your-prod-read-token"}'
```

Keys are environment names (`qa`, `staging`, `prod`, or another `[a-z0-9_]+` identifier). Values are the matching read-scoped tokens. Dedicated `ROLLBAR_<ENVIRONMENT>_ACCESS_TOKEN` variables override the same key in the JSON map.

Requests default to `prod` when no credential environment is specified.

The Rollbar API base URL defaults to `https://api.rollbar.com`. Custom or proxied API endpoints can override it with `ROLLBAR_API_BASE_URL`; the value must use HTTPS and cannot include credentials, a query string, or a fragment.

Run the published package through an MCP client:

```bash
npx -y @andreimaxim/rollbar-mcp
```

It communicates over standard input and output, so running it directly appears to do nothing while it waits for an MCP client.

## Docker Sandboxes

[Docker Sandboxes](https://docs.docker.com/ai/sandboxes/mcp-gateway/) expose MCP through a host-side gateway (`sbx mcp`). The agent inside the sandbox never talks to this server. Register a local stdio command; `sbx` launches it on the host with your host credentials.

Put the Rollbar tokens in the host environment and register `npx`. The server already discovers every `ROLLBAR_<ENVIRONMENT>_ACCESS_TOKEN`, so qa, staging, prod, or any other profile just work — no image, env-file, or JSON map required:

```bash
export ROLLBAR_QA_ACCESS_TOKEN="your-qa-read-token"
export ROLLBAR_STAGING_ACCESS_TOKEN="your-staging-read-token"
export ROLLBAR_PROD_ACCESS_TOKEN="your-prod-read-token"

sbx mcp add rollbar --command npx --args "-y,@andreimaxim/rollbar-mcp"
sbx run claude --static-mcp rollbar
```

`sbx mcp add` has no `--env` flag. The host command inherits the environment of the gateway process. If `rollbar_list_environments` comes back empty, sandboxd did not see those exports (it is a background daemon, not your interactive shell). Point `--command` at a small wrapper that sources them, then execs `npx`:

```bash
#!/usr/bin/env bash
set -euo pipefail
set -a
source "$HOME/.config/rollbar-mcp.env"
set +a
exec npx -y @andreimaxim/rollbar-mcp
```

The agent still only sees the MCP tools. Tokens never enter the sandbox.

Use the Docker `--env-file` recipe below only when you want the MCP process itself in a container. Use `sbx secret set-custom` only when the MCP process must run *inside* the sandbox (for example Codex `experimental_environment = "remote"`). That in-sandbox path cannot tell Rollbar environments apart by hostname — they all call `api.rollbar.com` — so each `ROLLBAR_*_ACCESS_TOKEN` needs its own custom secret.

## Docker

The image speaks the same stdio protocol. Do not pass `-t`; a TTY breaks JSON-RPC on stdin/stdout.

```bash
docker build -t rollbar-mcp .
```

Create a `chmod 600` env file that contains only the environments you use:

```bash
# ~/.config/rollbar-mcp.env
ROLLBAR_QA_ACCESS_TOKEN=your-qa-read-token
ROLLBAR_STAGING_ACCESS_TOKEN=your-staging-read-token
ROLLBAR_PROD_ACCESS_TOKEN=your-prod-read-token
```

Or the equivalent JSON map:

```bash
ROLLBAR_ACCESS_TOKENS={"qa":"your-qa-read-token","prod":"your-prod-read-token"}
```

`--env-file` is the way to forward an arbitrary set of `ROLLBAR_*` variables without listing each one in client config:

```json
{
  "mcpServers": {
    "rollbar": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/home/you/.config/rollbar-mcp.env",
        "rollbar-mcp"
      ]
    }
  }
}
```

Clients that inject a static `env` block can instead pass `-e VAR` with no value so Docker forwards that variable from the client process. That only works for names the client already declared.

Docker MCP catalogs declare secrets by name and typically treat listed secrets as required. Prefer a single `ROLLBAR_ACCESS_TOKENS` secret there instead of one catalog secret per Rollbar environment.

## Amp

The distributable [`using-rollbar` skill](skill/using-rollbar/SKILL.md) includes the MCP launch configuration and exposes only `rollbar_list_environments` and `rollbar_get`. Install that directory as a project, personal, or workspace skill.

For a project skill, copy it into the repository:

```text
.agents/skills/using-rollbar/SKILL.md
```

For an orb, add credentials under personal, project, or workspace **Secrets & Env Vars**. The skill forwards `ROLLBAR_ACCESS_TOKENS` plus the common `qa`, `staging`, and `prod` variables. Prefer the JSON map when you need extra environments without editing the skill; add another environment-variable reference to `mcpServers.rollbar.env` only when you want a dedicated `ROLLBAR_<ENVIRONMENT>_ACCESS_TOKEN`. Amp starts the MCP server in the orb when it discovers the skill and reveals its tools only when the skill loads.

The previous `amp.rollbar.*` plugin settings are no longer read; the portable MCP server uses environment variables in every harness.

## Claude Code

Register the same stdio server at user scope:

```bash
claude mcp add --scope user --transport stdio rollbar -- \
  npx -y @andreimaxim/rollbar-mcp
```

Start Claude Code with the desired `ROLLBAR_*` variables available in its environment. For team distribution, put the equivalent server entry in the project's `.mcp.json` and keep credentials as environment-variable references.

To isolate the process in Docker instead of `npx`, use the Docker `command`/`args` example above.

## Codex

Add this entry to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.rollbar]
command = "npx"
args = ["-y", "@andreimaxim/rollbar-mcp"]
env_vars = [
  "ROLLBAR_ACCESS_TOKENS",
  "ROLLBAR_QA_ACCESS_TOKEN",
  "ROLLBAR_STAGING_ACCESS_TOKEN",
  "ROLLBAR_PROD_ACCESS_TOKEN",
  "ROLLBAR_API_BASE_URL",
]
enabled_tools = ["rollbar_list_environments", "rollbar_get"]
```

Forward only the credential environments you use. The `env_vars` list forwards existing variables without placing their values in the configuration file.

When Codex starts the server in a Docker sandbox, set `experimental_environment = "remote"` and read tokens from the remote executor:

```toml
[mcp_servers.rollbar]
command = "npx"
args = ["-y", "@andreimaxim/rollbar-mcp"]
experimental_environment = "remote"
env_vars = [
  { name = "ROLLBAR_ACCESS_TOKENS", source = "remote" },
  { name = "ROLLBAR_QA_ACCESS_TOKEN", source = "remote" },
  { name = "ROLLBAR_STAGING_ACCESS_TOKEN", source = "remote" },
  { name = "ROLLBAR_PROD_ACCESS_TOKEN", source = "remote" },
  { name = "ROLLBAR_API_BASE_URL", source = "remote" },
]
enabled_tools = ["rollbar_list_environments", "rollbar_get"]
```

`ROLLBAR_ACCESS_TOKENS` is the least brittle remote secret: one name covers every Rollbar environment. Dedicated `ROLLBAR_*_ACCESS_TOKEN` entries still work when those variables exist in the remote environment. If the remote executor uses Docker Sandboxes placeholder injection instead of real values, use the per-environment custom-secret path above rather than the JSON map.

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

Build the image and confirm it speaks stdio:

```bash
docker build -t rollbar-mcp .
docker run -i --rm --env-file ~/.config/rollbar-mcp.env rollbar-mcp
```

Repository layout:

- `src/rollbar.ts` contains credential discovery, request validation, the Rollbar HTTP client, redirect confinement, and bounded output formatting.
- `src/server.ts` registers the MCP tools and their read-only annotations.
- `src/index.ts` starts the stdio server.
- `Dockerfile` builds the stdio image used by Docker clients and Docker Sandboxes.
- `skill/using-rollbar/SKILL.md` contains the Amp skill and its MCP launch configuration.
- `test/` contains HTTP-client and protocol-level integration tests.
