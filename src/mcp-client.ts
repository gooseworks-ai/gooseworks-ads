/**
 * Thin client for the Gooseworks app-mcp server (Streamable HTTP at <mcpUrl>),
 * authenticated with the cal_ token. Used only for the CLI's own diagnostic
 * calls (whoami). The actual ad work runs in the user's Claude Code session via
 * the registered `gooseworks` MCP server, not here.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface McpSettings {
  token: string;
  mcpUrl: string;
}

/** Connect, run `fn(client)`, always close. */
export async function withMcp<T>(
  settings: McpSettings,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(settings.mcpUrl), {
    requestInit: {
      headers: { Authorization: `Bearer ${settings.token}` },
    },
  });
  const client = new Client({ name: "goose-video", version: "0.0.1" }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch (err) {
    const e = err as { cause?: { code?: string }; code?: string; message?: string };
    const code = e?.cause?.code || e?.code;
    if (code === "ECONNREFUSED" || /fetch failed/i.test(e?.message || "")) {
      throw new Error(
        `Can't reach app-mcp at ${settings.mcpUrl}. Is it running?\n` +
          "  Start it:  cd backend && npm run app-mcp:dev   (listens on :6200)",
      );
    }
    if (/401|unauthor/i.test(e?.message || "")) {
      throw new Error("app-mcp rejected the token (401). Re-run `goose-video login`.");
    }
    throw err;
  }
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Call a tool and return its first text block parsed as JSON (falling back to
 * the raw string). Throws on `isError` results so callers see real failures.
 */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  const text = (result?.content || [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
  if (result?.isError) {
    throw new Error(`app-mcp ${name} failed: ${text || "unknown error"}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
