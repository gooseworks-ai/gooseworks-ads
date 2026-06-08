/**
 * Render the vendored master skill (the runtime contract) with both recipe
 * paths + the goose-graphics dir resolved. The rendered body becomes the
 * SKILL.md installed into the user's Claude Code — the runtime is the user's
 * own Claude Code session (there is no embedded agent here).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gooseGraphicsDir, resolveSkill } from "./skills-repo.js";

// dist/prompt.js → ../skills/master.md resolves to the package root's skills/
// dir (shipped via package.json "files"), same as the source layout.
const MASTER_PATH = fileURLToPath(new URL("../skills/master.md", import.meta.url));

/** Read master.md and substitute the recipe paths + graphics dir. */
export async function renderMasterSkill({ update = false }: { update?: boolean } = {}): Promise<string> {
  const master = await readFile(MASTER_PATH, "utf8");
  const [brandResearch, staticRemix] = await Promise.all([
    resolveSkill("brand-research", { update }),
    resolveSkill("static", { update }),
  ]);
  return master
    .replaceAll("{{BRAND_RESEARCH_RECIPE}}", brandResearch.skillMd)
    .replaceAll("{{REMIX_STATIC_RECIPE}}", staticRemix.skillMd)
    .replaceAll("{{GOOSE_GRAPHICS_DIR}}", gooseGraphicsDir());
}
