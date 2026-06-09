/**
 * `goose-video login` — loopback OAuth flow against the Gooseworks web app.
 *
 * The web `/cli/auth` page expects a `callback_port`: we stand up a tiny local
 * HTTP server, open the page pointed at it, and the page (after Google sign-in
 * or an existing session) redirects the freshly-minted token back to
 * `http://localhost:<port>/callback?token=…&mcp_server_url=…`. We capture it,
 * verify the `state` nonce, and persist.
 *
 * We request `scope_type=agent` so the token is pinned to an agent — the media
 * proxies need an agent to bill (a user-scoped token would 402/403 on generation).
 *
 * Escape hatch: `goose-video login --token cal_…` skips the browser entirely.
 */
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { saveConfig, defaults, type Flags } from "../config.js";
import { setupClaudeCode } from "../claude-setup.js";

interface LoginResult {
  token: string;
  scopeType: string | null;
  agentId: string | null;
  email: string | null;
  mcpServerUrl: string | null;
  apiBase: string | null;
}

/**
 * After the token is saved, wire up the user's Claude Code (skill + MCP server)
 * and print how to actually use it: open Claude, paste a remix instruction.
 */
async function finishLogin(settings: {
  token: string;
  mcpUrl: string;
  remixBrowseUrl: string;
}): Promise<void> {
  console.log("\nSetting up Claude Code…");
  await setupClaudeCode(settings);
  console.log(
    "\nDone. Everything else happens in Claude Code — open it and paste an instruction, e.g.:\n" +
      '  "Use the ads-remix skill to remix template <id> for my brand https://acme.com —\n' +
      '   research the brand, create the project, and generate the final ad."\n' +
      `Browse templates and copy a ready-made prompt at ${settings.remixBrowseUrl}.\n` +
      "(If Claude Code was already open, restart it or run /mcp so it picks up the new\n" +
      " ads-remix skill + tools.)",
  );
}

const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort — URL is printed below regardless */
  }
}

const stripSlash = (u: string): string => u.replace(/\/+$/, "");

/** Derive the /mcp endpoint from the mcp_server_url the page hands back. */
function deriveMcpUrl(mcpServerUrl: string | null, fallback: string): string {
  if (!mcpServerUrl) return fallback;
  const base = stripSlash(mcpServerUrl);
  return /\/mcp$/.test(base) ? base : `${base}/mcp`;
}

export async function login(flags: Flags): Promise<void> {
  // defaults() folds in the selected environment (--local/--prod/GOOSE_VIDEO_ENV,
  // default prod) plus any per-URL flag/env overrides.
  const d = defaults(flags);
  const apiBase = d.apiBase;
  const webUrl = d.webUrl;
  console.log(`Environment: ${d.env}  (apiBase ${apiBase}, web ${webUrl})`);

  // Manual mode — paste a token you already minted.
  if (typeof flags.token === "string" && flags.token.startsWith("cal_")) {
    await saveConfig({
      token: flags.token,
      apiBase,
      mcpUrl: d.mcpUrl,
      env: d.env,
    });
    console.log("Saved token to ~/.goose-video/config.json");
    await finishLogin({
      token: flags.token,
      mcpUrl: d.mcpUrl,
      remixBrowseUrl: `${d.webUrl}/browse`,
    });
    return;
  }

  const nonce = randomUUID();
  const result = await new Promise<LoginResult>((resolve, reject) => {
    let settled = false;
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/callback") {
        res.writeHead(204).end();
        return;
      }
      const token = url.searchParams.get("token");
      const returnedState = url.searchParams.get("state");
      // Connection: close so the browser drops the socket immediately — without
      // it the keep-alive socket lingers and the CLI process won't exit.
      res.writeHead(200, { "content-type": "text/html", connection: "close" });
      res.end(
        '<html><body style="font-family:system-ui;text-align:center;padding:3rem;color:#1c1917">' +
          (token
            ? "<h3>Authenticated</h3><p>You can close this tab and return to the terminal.</p>"
            : "<h3>Login failed</h3><p>No token received. Re-run <code>goose-video login</code>.</p>") +
          "</body></html>",
      );
      if (settled) return;
      settled = true;
      server.close();
      server.closeAllConnections?.(); // force-drop any keep-alive sockets (Node 18.2+)
      if (!token) return reject(new Error("No token in callback."));
      if (nonce && returnedState && returnedState !== nonce) {
        return reject(new Error("State mismatch — aborting (possible CSRF)."));
      }
      resolve({
        token,
        scopeType: url.searchParams.get("scope_type"),
        agentId: url.searchParams.get("agent_id"),
        email: url.searchParams.get("email"),
        mcpServerUrl: url.searchParams.get("mcp_server_url"),
        apiBase: url.searchParams.get("api_base"),
      });
    });

    server.on("error", reject);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo | null;
      const port = addr ? addr.port : 0;
      // agent_target=org_default pins the token to the org's shared "Ads agent",
      // so the local worker reads/writes the same storage the in-app ads flow uses.
      const authUrl = `${webUrl}/cli/auth?callback_port=${port}&state=${nonce}&scope_type=agent&agent_target=org_default`;
      console.log(`\nOpening ${authUrl}`);
      console.log("Sign in with Google if prompted; this tab returns automatically.\n");
      openBrowser(authUrl);
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error("Login timed out after 3 minutes."));
    }, LOGIN_TIMEOUT_MS).unref();
  });

  const mcpUrl = deriveMcpUrl(result.mcpServerUrl, d.mcpUrl);
  // Prefer the backend's own API base (the env the user actually authed against)
  // over the CLI's env-default guess, so apiBase + mcpUrl always point at the
  // same host — fixes "MCP on prod, proxies on localhost".
  const resolvedApiBase = result.apiBase ? stripSlash(result.apiBase) : apiBase;
  await saveConfig({
    token: result.token,
    apiBase: resolvedApiBase,
    mcpUrl,
    env: d.env,
    email: result.email || undefined,
    agentId: result.agentId || undefined,
  });

  console.log(`Logged in${result.email ? ` as ${result.email}` : ""}.`);
  if (result.scopeType && result.scopeType !== "agent") {
    console.warn(
      `\n⚠ Token scope is "${result.scopeType}", not "agent". Media generation will be\n` +
        "  rejected (no agent to bill). Make sure the web /cli/auth page honors\n" +
        "  ?scope_type=agent (frontend change), then re-run login.",
    );
  }

  await finishLogin({ token: result.token, mcpUrl, remixBrowseUrl: `${d.webUrl}/browse` });
}
