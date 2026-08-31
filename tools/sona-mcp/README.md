# sona-mcp

A read-only MCP server over Sona's meeting corpus. Six tools, stdio transport,
no state: each call spawns the installed Sona binary with one of its read-only
flags and hands the JSON back.

Everything it can reach is behind one switch. **Settings > Agents > External
access** is off on install, and while it is off every tool refuses with
`consent_required` and says where the switch is. Nothing on this surface
writes — there is no tool here that can change a meeting, resolve a loop, or
rename a person.

## Install

```bash
cd tools/sona-mcp
bun install
```

Register it with your agent:

```bash
# Claude Code
claude mcp add sona -- bun /absolute/path/to/sona/tools/sona-mcp/src/index.ts

# Codex
codex mcp add sona -- bun /absolute/path/to/sona/tools/sona-mcp/src/index.ts
```

The server resolves Sona at `/Applications/Sona.app/Contents/MacOS/sona`.
Point `SONA_BIN` somewhere else for a dev build:

```bash
claude mcp add sona --env SONA_BIN=/path/to/sona/src-tauri/target/debug/sona \
  -- bun /absolute/path/to/sona/tools/sona-mcp/src/index.ts
```

## Tools

| Tool                | Arguments                    | Runs                                            |
| ------------------- | ---------------------------- | ----------------------------------------------- |
| `sona_search`       | `query`, `scope?`, `limit?`  | `sona --query … [--scope …] [--limit …]`        |
| `sona_meetings`     | `last?` \| (`from` + `to`)   | `sona --meetings [--last …] [--from … --to …]`  |
| `sona_meeting`      | `meeting_id`                 | `sona --meeting <id>`                           |
| `sona_transcript`   | `meeting_id`                 | `sona --transcript <id>`                        |
| `sona_action_items` | `status?`, `side?`, `limit?` | `sona --loops [--status …] [--mine\|--waiting]` |
| `sona_people`       | `name`, `limit?`             | `sona --people <name> [--limit …]`              |

`scope` is one of `all`, `meetings`, `dictations`, `people`, `loops`. `status`
is `open` or `done`. `side` is `mine` (what you owe) or `waiting` (what
somebody else owes you). Every schema documents these enums, so a client
picking from the schema cannot compose a command Sona refuses.

Sona's `--events` flag — the receipt and workflow-run stream — is deliberately
CLI-only. It pages by receipt id, which is a cursor an agent has no use for
between calls on a server that keeps no state.

## What comes back

One JSON object per call, as one text block. Every payload carries a
`schema_version`, and every row carries a `sona://` address the app can open:
`sona://meeting/<uuid>`, `sona://loop/<id>`, `sona://person/<uuid>`,
`sona://dictation/<id>`.

## Refusals

Errors are MCP errors carrying Sona's own machine token in `data.code`:

| `data.code`        | Means                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| `consent_required` | External access is off. `data.settingsPath` names the row to turn on. |
| `unavailable`      | Meeting storage is not open — usually a locked login keychain.        |
| `invalid_request`  | A bad id, date or limit.                                              |
| `not_found`        | The id parsed but names nothing in this corpus.                       |
| `not_installed`    | No Sona binary where this server looked.                              |
| `timed_out`        | Sona did not answer in 30s.                                           |

## Tests

```bash
bun test        # tool → argv mapping and refusal passthrough, against a stub binary
bunx tsc --noEmit
```
