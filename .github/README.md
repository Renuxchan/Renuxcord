# Renuxcord

**190 plugins, AI built in, always up to date.** Renuxcord is a Discord client mod with an AI bridge that lets Claude build your Discord servers, Claude inside Discord, a command palette, a theme engine and a stack of Renuxcord Exclusive plugins. It updates itself, and Discord-update fixes arrive automatically.

## Install

1. Download **RenuxcordInstaller.exe** from the [latest release](../../releases/latest).
2. Run it, pick your Discord (Stable, PTB or Canary) and press **Install / Repair**.
3. Discord restarts with Renuxcord. Settings and themes from a previous client mod install are carried over the first time.

Uninstall the same way. Your Renuxcord settings stay in `%APPDATA%\Renuxcord`.

## ✦ Renuxcord Exclusives

| Plugin | What it does |
| --- | --- |
| **RenuxBridge** | AI bridge for Claude Code (MCP). Say "make me a gaming server with roles and private staff channels" and it happens in Discord |
| **RenuxAI** | Claude inside Discord: `/ai ask`, `/ai summarize`, `/ai rewrite`, `/ai translate`, and right-click any message to explain it or get a reply suggestion |
| **CommandPalette** | `Ctrl+Shift+K`: toggle any plugin, switch profiles, run toolbox actions, open settings, jump to servers |
| **RenuxTheme** | Theme engine: colour presets, custom accent, background image with blur/dim/glass, rounder corners, any Google Font. Live preview |
| **ServerBlueprints** | Copy a server's roles, channels and permissions as JSON, paste blueprints into your servers, or clone a server's layout in one click |
| **LinkSafety** | Warns under messages with scam links: fake Discord/Steam/Roblox domains, look-alike characters, raw IPs, masked link tricks, free-nitro bait |
| **GhostPingAlert** | Tells you who pinged you and what they said when they delete it or edit the ping out |
| **KeywordAlerts** | Notifications for your own keywords or regexes anywhere you are |
| **MentionSound** | Custom ping sounds (built-in synth sounds or your own file) |
| **MessageScheduler** | `/schedule 2h30m hey` or `/schedule 9pm ...` to send messages later |
| **Bookmarks** | Save messages and find them again in a searchable list with jump-to-message |
| **FriendWatch** | Get notified when people you pick come online or start a game |
| **VoiceLog** | Timestamped log of who joined and left your voice channel |
| **SessionStats** | Your own stats: messages, pings, time online and in voice (`/stats`) |
| **PluginProfiles** | Save sets of enabled plugins (Gaming, Minimal, Streaming) and switch in one click, plus safe mode |
| **RenuxBadges** | Renuxcord profile badges for the owner, devs and friends of the project |

Every one of them carries the **✦ RENUXCORD EXCLUSIVE** badge in Settings > Renuxcord > Plugins, sorted to the top, with a "Show Renuxcord Exclusive" filter. The 170+ classic plugins are all there too.

## Let AI build your servers (RenuxBridge + MCP)

1. Turn on **RenuxBridge** in Settings > Renuxcord > Plugins.
2. Open its settings and press **Copy command**, then run it once in a terminal. It looks like:

   ```sh
   claude mcp add renuxcord --scope user -- node "%APPDATA%\Renuxcord\dist\renuxcord-mcp.mjs"
   ```

3. Start a new Claude Code session and ask for what you want:
   - "create a server called Night Shift for my valorant team: roles for coach, players, subs, a private staff area, voice lobbies and a rules channel"
   - "give the Mod role timeout and manage messages, then lock #announcements so only Mods can post"
   - "export the layout of my main server and clone it into a new one"
   - `/mcp__renuxcord__build_server` and `/mcp__renuxcord__audit_server` are ready-made prompts

The bridge only listens on `127.0.0.1`, needs a random token that only local tools can read, rejects web pages, works at a human pace, and never touches DMs. Deleting stays off until you switch on **Allow deleting** in its settings.

## Updates

- **Renuxcord updates itself** from this repository's `devbuild` release (Settings > Renuxcord > Updater, auto-update is on by default).
- **Upstream fixes flow in by themselves**: a workflow merges the upstream project every 6 hours, checks that it builds and publishes a new release.

## Build from source

```sh
pnpm install
pnpm install --dir mcp --ignore-workspace
pnpm build --standalone
node scripts/renuxcord/buildMcp.mjs
node scripts/renuxcord/install.mjs install   # copies dist/ to %APPDATA%\Renuxcord and patches Discord
node scripts/renuxcord/install.mjs status
node scripts/renuxcord/install.mjs uninstall
```

The Windows installer builds with the C# compiler that ships with Windows: `powershell -ExecutionPolicy Bypass -File installer/build.ps1`.

### Maintainer notes

- Renuxcord's code lives in new files wherever possible (`src/plugins/<renuxcord plugins>`, `src/utils/renuxcord*.ts`, `mcp/`, `installer/`, `scripts/renuxcord/`) and branding changes are small edits, so upstream merges rarely conflict.
- If upstream changes `.github/workflows`, the sync job can only push them with a token that has the `workflow` scope. Add a fine-grained token as the `SYNC_TOKEN` repository secret.
- Add badge holders to [`badges.json`](../badges.json) by Discord user ID.

## License

GPL-3.0-or-later, see [LICENSE](../LICENSE). Renuxcord is a modified version of Vencord by Vendicated and contributors; their copyright notices are kept in the source as the license requires. Client mods are against Discord's Terms of Service, use at your own risk.
