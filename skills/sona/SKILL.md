---
name: sona
description: Read and act on the Sona meeting corpus on this Mac — meetings, transcripts, people, open loops, receipts, and the week ahead — through the `sona` CLI or the `sona-mcp` server. Use when the user asks what was said in a meeting, what they owe somebody, who a person is, what is scheduled, or asks to close a loop.
---

# Sona

Sona is a local meeting-notes and dictation app. Its corpus lives on this Mac,
encrypted. Nothing below reaches a network.

## Consent

Two settings rows, both off on install:

- **Settings > Agents > External access** — the reads.
- **Settings > Agents > External mutations** — the one write.

While a row is off, every verb needing it exits non-zero and prints
`{"error":"consent_required","settings_path":"…"}` on stderr. Tell the user the
`settings_path`; do not retry.

## CLI

One verb per invocation. One JSON value on stdout, or one JSON refusal on
stderr. Exit codes: `0` answered, `2` bad input (`invalid_request`), `1`
everything else (`consent_required`, `unavailable`, `not_found`, `failed`).

| Flag                                                | What it answers                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `--query <TEXT> [--scope S] [--limit N]`            | Search. `S` ∈ `all`\|`meetings`\|`dictations`\|`people`\|`loops` |
| `--meetings [--last N \| --from D --to D]`          | Retained meetings, newest first. `D` is local `YYYY-MM-DD`       |
| `--meeting <MEETING_ID>`                            | One meeting: summary, headline, notes, loops                     |
| `--transcript <MEETING_ID>`                         | One meeting's speaker-labeled lines                              |
| `--loops [--status open\|done] [--mine\|--waiting]` | Loops and commitments across the corpus                          |
| `--people <NAME>`                                   | A person by name, alias or calendar address                      |
| `--events [--after <EVENT_ID>]`                     | Receipts and workflow runs, newest first                         |
| `--upcoming [--limit N]`                            | Today plus the next seven local days of calendar                 |
| `--loop-resolve <LOOP_ID>`                          | **Writes.** Marks one loop done, prints the receipt              |

`--limit` caps rows at 100 and defaults to 25; `--meetings` counts with
`--last` instead.

## JSON shapes

Every payload carries `schema_version`. Page payloads carry `entries` and
`has_more`. Every row carries a `sona://` `link`.

```
--meetings   {"schema_version":1,"entries":[{"id":uuid,"title":str,"phase":str,
              "when_utc_ms":int,"recorded_duration_ms":int|null,"speakers":[str],
              "headline":{…},"link":str}],"has_more":bool}
--meeting    {"schema_version":1,"id":uuid,"title":str,"phase":str,
              "started_at_utc_ms":int|null,"speakers":[str],"summary":str|null,
              "headline":str|null,"notes":[str],"loops":[loop],"link":str}
--transcript {"schema_version":1,"meeting_id":uuid,"title":str,
              "started_at_utc_ms":int|null,
              "lines":[{"speaker":str,"start_ms":int,"end_ms":int,"text":str}],"link":str}
--loops      entries of loop: {"id":str,"meeting_id":uuid,"meeting_title":str,
              "kind":"loop"|"commitment","status":"open"|"done"|"dropped"|"carried",
              "direction":"mine"|"waiting_on"|"unattributed","text":str,
              "owner":str|null,"when_utc_ms":int,
              "resolved_at_utc_ms":int|null,"link":str}
--people     entries of {"id":uuid,"display_name":str,"aliases":[str],
              "calendar_emails":[str],"meetings_count":int,
              "last_meeting_at_utc_ms":int|null,"last_meeting_title":str|null,
              "last_meeting_headline":str|null,"link":str}
--upcoming   {"schema_version":1,"calendar_access":"not_determined"|"authorized"|
              "denied"|"unavailable","window_start_utc_ms":int,
              "window_end_utc_ms":int,"entries":[{"event_key":str,"title":str,
              "start_utc_ms":int,"end_utc_ms":int,"attendees":[str],
              "attendee_count":int,"calendar_name":str|null,"join_url":str|null,
              "series_key":str|null,"always_record":bool}],"has_more":bool}
--loop-resolve
             {"schema_version":1,"receipt":{"operation_id":uuid,
              "session_id":uuid|null,"actor":"user"|"system",
              "command":"loop_resolve","expected_revision":int,
              "requested_at_utc_ms":int,"committed_at_utc_ms":int|null,
              "result":"committed"|"rejected"|"failed","reason_codes":[str],
              "new_revision":int|null,"effect_ids":[str]}}
```

An empty `--upcoming` list under `calendar_access` other than `authorized`
means Sona has no calendar grant, not a free week.

`--loop-resolve` reads the meeting's loop revision, then writes against it.
`result: "rejected"` means the meeting changed in between — re-read `--loops`
and decide again rather than retrying blindly.

## MCP

`tools/sona-mcp` is a stdio server over exactly those flags. Same consent, same
refusals (`data.code`, `data.settingsPath`).

| Tool                | Arguments                                        |
| ------------------- | ------------------------------------------------ |
| `sona_search`       | `query`, `scope?`, `limit?`                      |
| `sona_meetings`     | `last?` \| (`from` + `to`)                       |
| `sona_meeting`      | `meeting_id`                                     |
| `sona_transcript`   | `meeting_id`                                     |
| `sona_action_items` | `status?`, `side?` (`mine`\|`waiting`), `limit?` |
| `sona_people`       | `name`, `limit?`                                 |
| `sona_upcoming`     | `limit?`                                         |
| `sona_loop_resolve` | `loop_id` — writes                               |

`--events` is CLI-only: it pages by receipt id, which a stateless server has no
use for between calls.

```bash
claude mcp add sona -- bun /absolute/path/to/sona/tools/sona-mcp/src/index.ts
```

## `sona://` links

Every row's `link` opens the app at that row. Hand them to the user instead of
describing where to click.

| Form                                                           | Opens                                       |
| -------------------------------------------------------------- | ------------------------------------------- |
| `sona://meeting/<uuid>`                                        | the meeting                                 |
| `sona://loop/<meeting-uuid>:<kind>:<digest>`                   | the meeting review, at the loop             |
| `sona://person/<uuid>`                                         | the person's page                           |
| `sona://organization/<slug>`                                   | everybody at one organization               |
| `sona://dictation/<id>`                                        | the dictation in Library                    |
| `sona://search?q=<text>`                                       | search, with the question in it             |
| `sona://record`, `sona://record?mode=<id>`, `sona://mode/<id>` | dictation controls                          |
| `sona://meeting/start`                                         | the meeting screen — does not begin capture |

## Rules

- Quote what the corpus says and cite the `link`. Do not infer a commitment,
  date or owner that no row carries.
- Read before you write: `--loop-resolve` is the only verb that changes
  anything, and it needs a `loop_id` that came out of a read.
- A refusal is an answer. Report the code and the `settings_path`; the user
  clears it, not you.
