export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type QueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>;

export interface RollbarService {
  listEnvironments(): Promise<string[]>;
  get(
    path: string,
    environment?: string,
    query?: Record<string, QueryValue>,
  ): Promise<Json>;
}

const DEFAULT_API_BASE_URL = "https://api.rollbar.com";
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;
const MAX_TRUNCATION_NOTICE_BYTES = 256;
const MAX_REDIRECTS = 5;

const ENVIRONMENT_NAME = /^[a-z0-9_]+$/;

function tokenEnvironmentVariables(env: NodeJS.ProcessEnv): Map<string, string> {
  const variables = new Map<string, string>();
  for (const name of Object.keys(env)) {
    const match = /^ROLLBAR_([A-Z0-9_]+)_ACCESS_TOKEN$/i.exec(name);
    if (match?.[1]) variables.set(match[1].toLowerCase(), name);
  }
  return variables;
}

function isUsableSecret(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !/^\$\{[A-Z0-9_]+\}$/.test(trimmed);
}

function parseAccessTokensJson(raw: string | undefined): Map<string, string> {
  const tokens = new Map<string, string>();
  if (!isUsableSecret(raw)) return tokens;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "ROLLBAR_ACCESS_TOKENS must be a JSON object of environment names to access tokens",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "ROLLBAR_ACCESS_TOKENS must be a JSON object of environment names to access tokens",
    );
  }

  for (const [environment, token] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    const name = environment.toLowerCase();
    if (!ENVIRONMENT_NAME.test(name)) {
      throw new Error(
        `ROLLBAR_ACCESS_TOKENS has an invalid environment name: ${environment}`,
      );
    }
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new Error(
        `ROLLBAR_ACCESS_TOKENS.${name} must be a non-empty string`,
      );
    }
    tokens.set(name, token.trim());
  }
  return tokens;
}

function configuredTokens(env: NodeJS.ProcessEnv): Map<string, string> {
  const tokens = parseAccessTokensJson(env.ROLLBAR_ACCESS_TOKENS);
  for (const [environment, variable] of tokenEnvironmentVariables(env)) {
    const token = env[variable];
    if (isUsableSecret(token)) tokens.set(environment, token.trim());
  }
  return tokens;
}

function missingTokenMessage(environment: string): string {
  return `Configure ROLLBAR_${environment.toUpperCase()}_ACCESS_TOKEN or include "${environment}" in ROLLBAR_ACCESS_TOKENS with a read-scoped Rollbar token`;
}

function normalizedApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("ROLLBAR_API_BASE_URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("ROLLBAR_API_BASE_URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new Error(
      "ROLLBAR_API_BASE_URL must not contain a query string or fragment",
    );
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatResult(
  value: Json,
  reservedBytes = 0,
): string {
  const output = JSON.stringify(value, null, 2);
  const allLines = output.split("\n");
  const totalBytes = Buffer.byteLength(output);
  const availableBytes = Math.max(0, MAX_OUTPUT_BYTES - reservedBytes);
  if (allLines.length <= MAX_OUTPUT_LINES && totalBytes <= availableBytes) {
    return output;
  }

  const contentLineLimit = MAX_OUTPUT_LINES - 2;
  const lineLimited = allLines.slice(0, contentLineLimit).join("\n");
  const encoded = new TextEncoder().encode(lineLimited);
  let end = Math.min(
    encoded.length,
    Math.max(0, availableBytes - MAX_TRUNCATION_NOTICE_BYTES),
  );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let content: string | undefined;
  while (content === undefined) {
    try {
      content = decoder.decode(encoded.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  const outputLines = content.split("\n").length;
  return `${content}\n\n[Output truncated: ${outputLines} of ${allLines.length} lines (${formatSize(end)} of ${formatSize(totalBytes)}).]`;
}

export class RollbarClient implements RollbarService {
  readonly #env: NodeJS.ProcessEnv;
  readonly #fetch: typeof fetch;

  constructor(options: {
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
  } = {}) {
    this.#env = options.env ?? process.env;
    this.#fetch = options.fetch ?? fetch;
  }

  async listEnvironments(): Promise<string[]> {
    return [...configuredTokens(this.#env).keys()].sort();
  }

  async get(
    path: string,
    environment = "prod",
    query?: Record<string, QueryValue>,
  ): Promise<Json> {
    const token = configuredTokens(this.#env).get(environment);
    if (!token) {
      throw new Error(missingTokenMessage(environment));
    }

    const apiBaseUrl = normalizedApiBaseUrl(
      this.#env.ROLLBAR_API_BASE_URL || DEFAULT_API_BASE_URL,
    );
    const sentinelOrigin = "https://rollbar.invalid";
    if (!path.startsWith("/")) {
      throw new Error("Rollbar API path must begin with /");
    }
    const relativeUrl = new URL(path, sentinelOrigin);
    if (relativeUrl.origin !== sentinelOrigin) {
      throw new Error(
        "Rollbar API path must be relative to the configured origin",
      );
    }
    for (const [name, rawValue] of Object.entries(query ?? {})) {
      relativeUrl.searchParams.delete(name);
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        relativeUrl.searchParams.append(name, String(value));
      }
    }

    const allowedOrigin = new URL(apiBaseUrl).origin;
    let url = new URL(
      `${apiBaseUrl}${relativeUrl.pathname}${relativeUrl.search}`,
    );

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.#fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Rollbar-Access-Token": token,
        },
        redirect: "manual",
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (location) {
          if (redirects === MAX_REDIRECTS) {
            throw new Error(`Rollbar API exceeded ${MAX_REDIRECTS} redirects`);
          }
          const nextUrl = new URL(location, url);
          if (nextUrl.origin !== allowedOrigin) {
            throw new Error(
              "Rollbar API refused a redirect outside the configured origin",
            );
          }
          await response.body?.cancel();
          url = nextUrl;
          continue;
        }
      }

      const raw = await response.text();
      let body: Json = null;
      if (raw) {
        try {
          body = JSON.parse(raw) as Json;
        } catch {
          body = raw;
        }
      }
      if (!response.ok) {
        const prefix = `Rollbar API ${response.status} ${response.statusText}: `;
        throw new Error(
          `${prefix}${formatResult(body, Buffer.byteLength(prefix))}`,
        );
      }
      return body;
    }

    throw new Error(`Rollbar API exceeded ${MAX_REDIRECTS} redirects`);
  }
}
