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

function tokenEnvironmentVariables(env: NodeJS.ProcessEnv): Map<string, string> {
  const variables = new Map<string, string>();
  for (const name of Object.keys(env)) {
    const match = /^ROLLBAR_([A-Z0-9_]+)_ACCESS_TOKEN$/i.exec(name);
    if (match?.[1]) variables.set(match[1].toLowerCase(), name);
  }
  return variables;
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
    const environments: string[] = [];
    for (const [environment, variable] of tokenEnvironmentVariables(this.#env)) {
      if (this.#env[variable]) environments.push(environment);
    }
    return environments.sort();
  }

  async get(
    path: string,
    environment = "prod",
    query?: Record<string, QueryValue>,
  ): Promise<Json> {
    const tokenVariable = tokenEnvironmentVariables(this.#env).get(environment);
    const token = tokenVariable ? this.#env[tokenVariable] : undefined;
    if (!token) {
      throw new Error(
        `Configure ROLLBAR_${environment.toUpperCase()}_ACCESS_TOKEN with a read-scoped Rollbar token`,
      );
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
