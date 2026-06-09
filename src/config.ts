/**
 * Config persistence for goose-video. One JSON file at ~/.goose-video/config.json
 * holding the cal_ token + the backend / app-mcp URLs. Mirrors how goose-aeo
 * stashes its credentials.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";

const CONFIG_DIR = join(homedir(), ".goose-video");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export { CONFIG_PATH };

export type EnvName = "local" | "prod";

interface EnvProfile {
  apiBase: string;
  mcpUrl: string;
  webUrl: string;
}

/** Parsed `--flag value` / `--flag=value` / bare `--flag` map. */
export interface Flags {
  [key: string]: string | boolean | undefined;
}

/** Shape of ~/.goose-video/config.json. */
export interface StoredConfig {
  token?: string;
  apiBase?: string;
  mcpUrl?: string;
  webUrl?: string;
  env?: EnvName;
  email?: string;
  agentId?: string;
}

/** Fully-resolved settings a command runs against. */
export interface Settings {
  token: string;
  env: EnvName;
  apiBase: string;
  mcpUrl: string;
  webUrl: string;
}

/** URL defaults for `login` (runs before a token exists). */
export interface LoginDefaults {
  env: EnvName;
  apiBase: string;
  mcpUrl: string;
  webUrl: string;
}

/**
 * Named environments. `prod` is the default for the published CLI; pass
 * `--local` (or `GOOSE_VIDEO_ENV=local`) for local dev. Individual URLs can
 * still be overridden per-call with `--api-base` / `--mcp-url` / `--web-url`
 * or the `GOOSE_VIDEO_API_BASE` / `_MCP_URL` / `_WEB_URL` env vars.
 *
 * Note: the /cli/auth login page is served by the WEB app (app.*); the proxies,
 * credits, and MCP are on the API (api.*). In local dev these are 3999 / 5999 /
 * 6200. `login` also overwrites mcpUrl with whatever the auth callback reports
 * (`mcp_server_url`), so the prod mcpUrl below is just a pre-login fallback.
 */
export const ENVIRONMENTS: Record<EnvName, EnvProfile> = {
  local: {
    apiBase: "http://localhost:5999",
    mcpUrl: "http://localhost:6200/mcp",
    webUrl: "http://localhost:4000",
  },
  prod: {
    apiBase: "https://api.gooseworks.ai",
    mcpUrl: "https://mcp.gooseworks.ai/mcp",
    webUrl: "https://ads.gooseworks.ai",
  },
};

const DEFAULT_ENV: EnvName = "prod";

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/** A flag value is only usable as a URL if it's a string (bare `--flag` → true). */
function asStr(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Was an environment explicitly chosen this invocation (flag or env var)? */
function envExplicitlySet(flags: Flags = {}): boolean {
  return Boolean(flags.local || flags.prod || process.env.GOOSE_VIDEO_ENV);
}

/**
 * Pick the environment name. Precedence:
 *   --local / --prod flag  >  GOOSE_VIDEO_ENV  >  saved config.env  >  "prod"
 */
export function resolveEnvName(flags: Flags = {}, cfg: StoredConfig = {}): EnvName {
  if (flags.local) return "local";
  if (flags.prod) return "prod";
  const fromVar = process.env.GOOSE_VIDEO_ENV;
  if (fromVar === "local" || fromVar === "prod") return fromVar;
  if (cfg.env === "local" || cfg.env === "prod") return cfg.env;
  return DEFAULT_ENV;
}

/** Read the saved config, or an empty object if there's none yet. */
export async function loadConfig(): Promise<StoredConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as StoredConfig;
  } catch {
    return {};
  }
}

/** Merge-write config. Creates ~/.goose-video with 0700 and the file with 0600. */
export async function saveConfig(patch: Partial<StoredConfig>): Promise<StoredConfig> {
  const current = await loadConfig();
  const next: StoredConfig = { ...current, ...patch };
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2));
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
  return next;
}

/**
 * Resolve the effective settings for a command. Per-URL precedence (high→low):
 *   1. explicit flag (--api-base …)
 *   2. explicit env var (GOOSE_VIDEO_API_BASE …)
 *   3. selected environment profile — ONLY when an env was explicitly chosen
 *      (--local/--prod/GOOSE_VIDEO_ENV), so you can switch without re-login
 *   4. saved config (what `login` pinned)
 *   5. selected-or-default environment profile
 * Throws (friendly) if there's no token.
 */
export async function resolveSettings(flags: Flags = {}): Promise<Settings> {
  const cfg = await loadConfig();
  const token = asStr(flags.token) || cfg.token;
  if (!token) {
    throw new Error("Not logged in. Run `goose-video login` first.");
  }
  const envName = resolveEnvName(flags, cfg);
  const profile = ENVIRONMENTS[envName];
  const explicit = envExplicitlySet(flags);

  const pick = (
    flagVal: string | undefined,
    envVar: string | undefined,
    cfgVal: string | undefined,
    profileVal: string,
  ): string => {
    if (flagVal) return flagVal;
    if (envVar) return envVar;
    if (explicit) return profileVal; // an explicit env switch ignores stale saved URLs
    if (cfgVal) return cfgVal;
    return profileVal;
  };

  return {
    token,
    env: envName,
    apiBase: stripSlash(
      pick(asStr(flags.apiBase), process.env.GOOSE_VIDEO_API_BASE, cfg.apiBase, profile.apiBase),
    ),
    mcpUrl: pick(asStr(flags.mcpUrl), process.env.GOOSE_VIDEO_MCP_URL, cfg.mcpUrl, profile.mcpUrl),
    webUrl: stripSlash(
      pick(asStr(flags.webUrl), process.env.GOOSE_VIDEO_WEB_URL, cfg.webUrl, profile.webUrl),
    ),
  };
}

/**
 * URL defaults for `login` (runs before there's a saved token). Honors the
 * selected environment plus per-URL flag/env overrides. `login` then persists
 * the resolved URLs + `env` so later commands stay on the same target.
 */
export function defaults(flags: Flags = {}): LoginDefaults {
  const envName = resolveEnvName(flags);
  const profile = ENVIRONMENTS[envName];
  return {
    env: envName,
    apiBase: stripSlash(asStr(flags.apiBase) || process.env.GOOSE_VIDEO_API_BASE || profile.apiBase),
    mcpUrl: asStr(flags.mcpUrl) || process.env.GOOSE_VIDEO_MCP_URL || profile.mcpUrl,
    webUrl: stripSlash(asStr(flags.webUrl) || process.env.GOOSE_VIDEO_WEB_URL || profile.webUrl),
  };
}

/** Delete the saved config (logout). No-op if there's nothing saved. */
export async function clearConfig(): Promise<void> {
  await rm(CONFIG_PATH, { force: true });
}
