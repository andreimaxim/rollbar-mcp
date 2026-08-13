---
name: using-rollbar
description: Investigates Rollbar items and occurrences through the read-only Rollbar MCP server. Use for production errors, exception triage, stack traces, occurrences, and Rollbar item links or numbers.
mcpServers:
  rollbar:
    command: npx
    args: ["-y", "@andreimaxim/rollbar-mcp"]
    env:
      ROLLBAR_ACCESS_TOKENS: "${ROLLBAR_ACCESS_TOKENS}"
      ROLLBAR_QA_ACCESS_TOKEN: "${ROLLBAR_QA_ACCESS_TOKEN}"
      ROLLBAR_STAGING_ACCESS_TOKEN: "${ROLLBAR_STAGING_ACCESS_TOKEN}"
      ROLLBAR_PROD_ACCESS_TOKEN: "${ROLLBAR_PROD_ACCESS_TOKEN}"
      ROLLBAR_API_BASE_URL: "${ROLLBAR_API_BASE_URL}"
    includeTools: ["rollbar_list_environments", "rollbar_get"]
---

# Using Rollbar

Use these request patterns for Rollbar investigations.

## Examples

Discover configured credential environments:

```json
{}
```

Call the example above with `rollbar_list_environments`. Use `prod` when the user does not specify an environment and it is available.

List active production errors with `rollbar_get`:

```json
{
  "path": "/api/1/items",
  "environment": "prod",
  "query": {
    "status": "active",
    "level": ["error", "critical"],
    "page": 1
  }
}
```

Filter items by a payload environment within the selected Rollbar project:

```json
{
  "path": "/api/1/items",
  "environment": "prod",
  "query": {
    "status": "active",
    "environment": "production",
    "page": 1
  }
}
```

Resolve item counter `456` from a Rollbar URL such as `/items/456/`:

```json
{
  "path": "/api/1/item_by_counter/456",
  "environment": "prod"
}
```

List recent occurrences using the internal item ID returned by Rollbar:

```json
{
  "path": "/api/1/item/123456789/instances",
  "environment": "prod",
  "query": {
    "limit": 20
  }
}
```

Fetch one occurrence's complete payload using an occurrence ID:

```json
{
  "path": "/api/1/instance/3209095494",
  "environment": "staging"
}
```

Keep the top-level credential `environment` consistent across an investigation. Compare multiple occurrences before claiming a pattern, treat sensitive payload fields carefully, and distinguish Rollbar evidence from source-code inference.

Do not create, modify, resolve, mute, or delete Rollbar data. This MCP server intentionally exposes no mutation tools.
