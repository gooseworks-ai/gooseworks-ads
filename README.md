# gooseworks-ads

Setup CLI for running Gooseworks ads locally in Claude Code.

The in-app ads chat runs the agent loop inside a cloud sandbox (expensive: sandbox + agent tokens, billed to Gooseworks). `goose-video` moves setup local: you run `goose-video login` once, then paste instructions into Claude Code. Gooseworks still brokers media generation (FAL / Higgsfield / ElevenLabs) through its proxies — billed to ad credits.

```
goose-video (this machine)                 Gooseworks cloud
  ├─ Claude Code (your ANTHROPIC key) ───── agent tokens on YOUR key
  ├─ ads-remix skill (installed by login) ◀── master skill ships in this repo
  ├─ app-mcp client ───────────────────────▶ app-mcp /mcp   (data + files + renders)
  └─ media calls ──────────────────────────▶ fal/hf/11labs proxies (billed to credits)
```

Recipe skills are pulled from [`gooseworks-ai/gooseworks-ads-skills`](https://github.com/gooseworks-ai/gooseworks-ads-skills) into `~/.goose-video/skills/` by `goose-video update`.

## Install

```bash
git clone git@github.com:gooseworks-ai/gooseworks-ads.git
cd gooseworks-ads
npm install
npm link            # dev: global `goose-video` on your PATH
# end users:
npx goose-video@latest login
# or: npm i -g goose-video && goose-video login
```

## Commands

| command   | what it does |
|-----------|--------------|
| `login`   | browser loopback auth → agent-scoped `cal_` token; installs `ads-remix` skill + registers MCP |
| `logout`  | clears `~/.goose-video/config.json` |
| `whoami`  | lists your ad brands via app-mcp |
| `credits` | shows the agent's credit balance |
| `update`  | re-pulls recipe skills + refreshes the installed skill |

After `login`, open Claude Code and paste an instruction, e.g.:

```
Use the ads-remix skill to remix template <id> for my brand https://acme.com —
research the brand, create the project, and generate the final ad.
```

Browse remixable templates at [gooseworks.ai/remix](https://gooseworks.ai/remix).

## Config

Stored at `~/.goose-video/config.json` (mode 0600). Override with `--api-base`, `--mcp-url`, `--web-url`, or env `GOOSE_VIDEO_API_BASE` / `GOOSE_VIDEO_MCP_URL` / `GOOSE_VIDEO_WEB_URL`.

## License

MIT
