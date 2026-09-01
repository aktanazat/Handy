#!/usr/bin/env bun
/* The stdio MCP server over Sona's read-only query surface.
 *
 * Transport and nothing else: the six tools are data in `tools.ts`, running
 * the binary is `cli.ts`, and this file is what turns a `tools/call` into an
 * argv and a refusal into an MCP error. Everything an agent reads here came
 * out of Sona a moment ago; this server holds no state between calls.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { runSona, SonaCliError } from "./cli.ts";
import { SonaInputError, TOOL_INPUT, TOOLS } from "./tools.ts";

/** The server, wired to the six tools and to nothing else.
 *
 * Construction is separated from `connect` so a test can hold this server on
 * an in-memory transport. That is not ceremony: the ESM link between this file
 * and `tools.ts` is the one thing no other check covers — `bun test`
 * transpiles without type-checking and the root lint never reaches this
 * directory — so a test that never constructs the server cannot tell a missing
 * export from a working one. */
export function createServer(): Server {
  const server = new Server(
    { name: "sona-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find(
      (candidate) => candidate.name === request.params.name,
    );
    if (tool === undefined) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `sona-mcp has no tool named ${request.params.name}.`,
      );
    }
    /* The transport is where a call first holds its arguments, so the schema
     * runs right here: a nested object reaches the agent as the bad parameter
     * it is rather than as a server fault. */
    const input = TOOL_INPUT.safeParse(request.params.arguments ?? {});
    if (!input.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Arguments must be a flat object of strings, numbers, booleans and nulls.",
      );
    }
    try {
      const argv = tool.argv(input.data);
      const answer = await runSona(argv);
      /* One text block holding the JSON Sona printed. No `structuredContent`:
       * this server declares no output schema, so a second copy of the same
       * bytes in a second field would be payload rather than information. */
      return {
        content: [{ type: "text", text: JSON.stringify(answer, null, 2) }],
      };
    } catch (error) {
      if (error instanceof SonaInputError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      if (error instanceof SonaCliError) {
        /* Sona's refusal, passed through rather than reworded. The consent one
         * is the only refusal a human can clear, so its message is the one that
         * names where the switch is — and an agent that reads `data.code` can
         * tell "you have not been allowed in" from "the corpus is not open". */
        throw new McpError(
          error.code === "consent_required"
            ? ErrorCode.InvalidRequest
            : ErrorCode.InternalError,
          error.settingsPath === undefined
            ? error.message
            : `${error.message} (${error.settingsPath})`,
          { code: error.code, settingsPath: error.settingsPath },
        );
      }
      throw error;
    }
  });

  return server;
}

/* Run as the binary: take stdio. Imported: do nothing, so a test can hold a
 * server of its own without racing this one for the same file descriptors. */
if (import.meta.main) {
  await createServer().connect(new StdioServerTransport());
}
