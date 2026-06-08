/**
 * `goose-video whoami` — verify the saved cal_ token reaches app-mcp by listing
 * the caller's ad brands. Doubles as a connectivity check for mcpUrl.
 */
import { resolveSettings, type Flags } from "../config.js";
import { withMcp, callTool } from "../mcp-client.js";

interface AdBrandLite {
  id?: string;
  slug?: string;
  name?: string;
}

export async function whoami(flags: Flags): Promise<void> {
  const settings = await resolveSettings(flags);
  console.log(`app-mcp: ${settings.mcpUrl}`);
  const brands = (await withMcp(settings, (client) =>
    callTool(client, "list_ad_brands", {}),
  )) as AdBrandLite[] | { items?: AdBrandLite[]; data?: AdBrandLite[] };
  // app-mcp list tools return { items, total, hasMore }.
  const list: AdBrandLite[] = Array.isArray(brands)
    ? brands
    : brands?.items || brands?.data || [];
  if (!Array.isArray(list) || list.length === 0) {
    console.log("Token OK. No ad brands yet — create one in the app first.");
    return;
  }
  console.log(`Token OK. ${list.length} brand(s):`);
  for (const b of list) {
    console.log(`  · ${b.slug || b.id}  ${b.name ? `— ${b.name}` : ""}`);
  }
}
