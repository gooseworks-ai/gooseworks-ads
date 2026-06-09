#!/usr/bin/env node
/**
 * goose-video — setup CLI for Gooseworks ads in your own Claude Code.
 *
 * `login` is the only step you run here: it authenticates, installs the
 * `ads-remix` skill into Claude Code, and registers the `gooseworks` MCP server.
 * After that, everything happens INSIDE your Claude Code session — you paste an
 * instruction and Claude does the brand research, brand/project creation, and
 * image generation via the skill + MCP tools. There are no remix/research
 * subcommands here by design.
 */
import type { Flags } from "./config.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { whoami } from "./commands/whoami.js";
import { credits } from "./commands/credits.js";
import { update } from "./commands/update.js";

const camel = (s: string): string => s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/** Minimal flag parser: `--key value` and `--key=value` and bare `--flag`. */
function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags[camel(a.slice(2, eq))] = a.slice(eq + 1);
    } else {
      const key = camel(a.slice(2));
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

const HELP = `goose-video — set up Gooseworks ads in your own Claude Code

Usage:
  goose-video login    [--prod | --local] [--web-url URL] [--auth-url URL] [--api-base URL] [--mcp-url URL] [--token cal_…]
  goose-video logout
  goose-video whoami                 # checks the token + app-mcp connection
  goose-video credits
  goose-video update                 # re-pull recipes + refresh the installed skill

That's the whole CLI. login installs the ads-remix skill into ~/.claude/skills and
registers the gooseworks MCP server (the app-mcp server, agent-scoped cal_ token).
Then open Claude Code and paste an instruction, e.g.:

  Use the ads-remix skill to remix template <id> for my brand https://acme.com —
  research the brand, create the project, and generate the final ad.

Browse remixable templates and copy a ready-made prompt at https://ads.gooseworks.ai/browse.
Generation runs on your own Claude Code session + ANTHROPIC key; media is billed to
ad credits.

Environments (default: prod):
  prod    ads.gooseworks.ai / api.gooseworks.ai     (the default; login --prod)
  local   localhost:4000 / :5999 / :6200            (login --local)
  Switch per-command with --prod / --local, or persist with GOOSE_VIDEO_ENV=local
  in your shell. login saves the chosen environment, so later commands stay on it.

Global flags: --prod, --local, --api-base, --mcp-url, --web-url, --auth-url, --token
  Per-URL flags / env vars override the environment. Env vars: GOOSE_VIDEO_ENV,
  GOOSE_VIDEO_API_BASE, GOOSE_VIDEO_MCP_URL, GOOSE_VIDEO_WEB_URL, GOOSE_VIDEO_AUTH_URL.`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  try {
    switch (command) {
      case "login":
        return await login(flags);
      case "logout":
        return await logout(flags);
      case "whoami":
        return await whoami(flags);
      case "credits":
        return await credits(flags);
      case "update":
        return await update(flags);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return;
      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`\nError: ${(err as Error)?.message || err}`);
    process.exitCode = 1;
  }
}

// Force a clean exit once the command resolves. The MCP client can leave
// timers/sockets ref'd, which would otherwise hang the process.
main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(`\nError: ${(err as Error)?.message || err}`);
    process.exit(1);
  },
);
