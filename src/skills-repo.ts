/**
 * Pulls the canonical ads skills from git into ~/.goose-video/skills/ and
 * resolves a project format → recipe SKILL.md. Single source of truth: the same
 * `gooseworks-ai/gooseworks-ads-skills` repo the cloud sandbox sparse-clones, so
 * local and cloud run the same recipes.
 *
 *   ~/.goose-video/skills/
 *     gooseworks-ads-skills/   ← static remix, brand-research, atoms, molecules
 *     goose-skills/            ← goose-graphics (HTML→PNG overlay)
 *
 * The format → skill MAP lives in the repo (`formats.json` at its root) so adding
 * a format (animated, podcast, …) is a repo-only change. Until that file exists,
 * we fall back to the bundled DEFAULT_FORMAT_MAP below.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SKILLS_DIR = join(homedir(), ".goose-video", "skills");

interface Repo {
  dir: string;
  url: string;
  sparse: string[];
  sentinel: string;
}

const REPOS: Record<string, Repo> = {
  ads: {
    dir: join(SKILLS_DIR, "gooseworks-ads-skills"),
    url: "https://github.com/gooseworks-ai/gooseworks-ads-skills.git",
    sparse: ["skills/"],
    sentinel: "skills/molecules/ad-format/remix-graphic-ad-from-reference/SKILL.md",
  },
  goose: {
    dir: join(SKILLS_DIR, "goose-skills"),
    url: "https://github.com/gooseworks-ai/goose-skills.git",
    sparse: ["skills/composites/goose-graphics/", "bin/", "package.json"],
    sentinel: "skills/composites/goose-graphics/SKILL.md",
  },
};

/** Format key → path (under the ads repo) of the recipe skill folder. */
const DEFAULT_FORMAT_MAP: Record<string, string> = {
  static: "skills/molecules/ad-format/remix-graphic-ad-from-reference",
  "brand-research": "skills/templates/brand-research",
};

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

/**
 * Remove stale git lock files a crashed/killed git process left behind. Without
 * this, a previously-wedged cache fails every later fetch with "Another git
 * process seems to be running … remove the file manually to continue".
 */
async function clearStaleLocks(repoDir: string): Promise<void> {
  await Promise.all(
    ["shallow.lock", "index.lock"].map((f) =>
      rm(join(repoDir, ".git", f), { force: true }).catch(() => {}),
    ),
  );
}

/** Sparse git clone, mirroring the sandbox's ensureAdsSkillsInstalled. */
async function pullRepo(repo: Repo, { update }: { update?: boolean }): Promise<string> {
  const cached = await exists(join(repo.dir, repo.sentinel));
  // Without an explicit refresh, a present cache is good enough — skip the pull.
  if (!update && cached) {
    return "cached";
  }
  await mkdir(repo.dir, { recursive: true });
  const git = (args: string[]) => run("git", args, { cwd: repo.dir });
  try {
    if (!(await exists(join(repo.dir, ".git")))) {
      await git(["init", "-q"]);
      await git(["remote", "add", "origin", repo.url]).catch(() => {});
    }
    await git(["config", "core.sparseCheckout", "true"]);
    await writeFile(join(repo.dir, ".git/info/sparse-checkout"), repo.sparse.join("\n") + "\n");
    await clearStaleLocks(repo.dir);
    // fetch + reset --hard, NOT `git pull`: a shallow clone reports "divergent
    // branches" once the remote tip has moved, which aborts pull (needs a merge
    // strategy) and leaves the cache stuck on its original commit. This force-
    // advances the sparse checkout to origin/main's tip cleanly — correct for a
    // first clone and a refresh alike, and it never prompts for a merge strategy.
    await git(["fetch", "-q", "--depth", "1", "origin", "main"]);
    await git(["reset", "-q", "--hard", "FETCH_HEAD"]);
  } catch (err) {
    // A refresh that can't reach the remote (offline, transient git error) must
    // not break setup when we already have a usable cache — fall back to it.
    // Only a first-ever pull (no cache) is fatal.
    if (cached) {
      console.warn(
        `  ⚠ couldn't refresh ${repo.url} (${(err as Error)?.message || err}); using cached skills.`,
      );
      return "cached (stale)";
    }
    throw err;
  }
  if (!(await exists(join(repo.dir, repo.sentinel)))) {
    throw new Error(`Skill repo pulled but sentinel missing: ${repo.sentinel}`);
  }
  return update ? "updated" : "cloned";
}

// Pull each repo at most once per process. renderMasterSkill resolves two recipes
// concurrently (Promise.all) and update.ts pre-pulls before installing — without
// memoizing, those fire overlapping `git fetch`/`reset` on the SAME dir, which
// races ("shallow file has changed since we read it") and can leave a half-written
// working tree that the recipe read then picks up stale. Keyed by dir+mode so a
// refresh (update:true) never reuses a cached-only (update:false) result.
const inflightPulls = new Map<string, Promise<string>>();

/**
 * Ensure both skill repos are present locally. `update: true` re-pulls latest.
 * Returns a per-repo status map for logging.
 */
export async function ensureSkillsPulled({ update = false }: { update?: boolean } = {}): Promise<
  Record<string, string>
> {
  const out: Record<string, string> = {};
  for (const [key, repo] of Object.entries(REPOS)) {
    const cacheKey = `${repo.dir}|${update ? "u" : "c"}`;
    let pull = inflightPulls.get(cacheKey);
    if (!pull) {
      pull = pullRepo(repo, { update });
      inflightPulls.set(cacheKey, pull);
    }
    out[key] = await pull;
  }
  return out;
}

/** Load the repo's format map (formats.json), falling back to the bundled default. */
async function loadFormatMap(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(REPOS.ads.dir, "formats.json"), "utf8");
    return { ...DEFAULT_FORMAT_MAP, ...(JSON.parse(raw) as Record<string, string>) };
  } catch {
    return DEFAULT_FORMAT_MAP;
  }
}

/**
 * Resolve a format key (e.g. "static", "brand-research") to the absolute path of
 * its recipe SKILL.md (and its folder). Ensures skills are pulled first.
 */
export async function resolveSkill(
  formatKey: string,
  { update = false }: { update?: boolean } = {},
): Promise<{ dir: string; skillMd: string }> {
  await ensureSkillsPulled({ update });
  const map = await loadFormatMap();
  const rel = map[formatKey];
  if (!rel) {
    const known = Object.keys(map).join(", ");
    throw new Error(`No skill mapped for format "${formatKey}". Known formats: ${known}.`);
  }
  const dir = join(REPOS.ads.dir, rel);
  const skillMd = join(dir, "SKILL.md");
  if (!(await exists(skillMd))) {
    throw new Error(`Recipe skill missing on disk: ${skillMd}. Try \`goose-video update\`.`);
  }
  return { dir, skillMd };
}

/** Absolute path to goose-graphics (HTML→PNG overlay), for recipes that use it. */
export function gooseGraphicsDir(): string {
  return join(REPOS.goose.dir, "skills/composites/goose-graphics");
}

export { SKILLS_DIR };
