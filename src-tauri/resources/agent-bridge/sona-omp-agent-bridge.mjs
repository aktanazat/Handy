const OMP_EXTENSION_SCHEMA_VERSION = 1;

function sessionId(ctx) {
	const value = ctx.sessionManager.getSessionId();
	return value.length > 0 ? value : undefined;
}

function toolKey(session, toolCallId) {
	return JSON.stringify([session, toolCallId]);
}

function copyToolInput(input) {
	try {
		return structuredClone(input);
	} catch {
		return undefined;
	}
}

async function invokeHook(payload, signal) {
	const hookPath = process.env.SONA_AGENT_HOOK?.trim();
	if (!hookPath || signal?.aborted) {
		return undefined;
	}

	let child;
	try {
		child = Bun.spawn([hookPath, "omp"], {
			stdin: new TextEncoder().encode(JSON.stringify(payload)),
			stdout: "pipe",
			stderr: "ignore",
			windowsHide: true,
		});
	} catch {
		return undefined;
	}

	const abort = () => child.kill();
	signal?.addEventListener("abort", abort, { once: true });
	try {
		const [exitCode, stdout] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
		]);
		return !signal?.aborted && exitCode === 0 ? stdout : undefined;
	} catch {
		return undefined;
	} finally {
		signal?.removeEventListener("abort", abort);
	}
}

function stopReply(stdout, schema) {
	if (!stdout) return undefined;
	try {
		const result = schema.safeParse(JSON.parse(stdout));
		return result.success ? result.data : undefined;
	} catch {
		return undefined;
	}
}

export default function sonaOmpAgentBridge(api) {
	const stopResponse = api.zod.object({
		decision: api.zod.literal("block"),
		reason: api.zod.string().min(1),
	});

	let sequence = 0;
	const toolCalls = new Map();

	const publish = async (event, ctx, fields = {}, signal) => {
		const activeSession = sessionId(ctx);
		if (!activeSession || !ctx.cwd) {
			return undefined;
		}
		return invokeHook(
			{
				schema_version: OMP_EXTENSION_SCHEMA_VERSION,
				event,
				session_id: activeSession,
				workspace_root: ctx.cwd,
				stop_hook_active: false,
				sequence: ++sequence,
				...fields,
			},
			signal,
		);
	};

	api.on("session_start", async (_event, ctx) => {
		await publish("session_start", ctx);
	});

	api.on("input", async (event, ctx) => {
		if (event.source === "extension") return;
		await publish("user_prompt_submit", ctx);
	});

	api.on("tool_call", (event, ctx) => {
		const activeSession = sessionId(ctx);
		const input = copyToolInput(event.input);
		if (!activeSession || input === undefined) return;
		toolCalls.set(toolKey(activeSession, event.toolCallId), {
			toolName: event.toolName,
			input,
		});
	});

	api.on("tool_approval_requested", async (event, ctx) => {
		if (event.sessionId !== sessionId(ctx)) return;
		const pending = toolCalls.get(toolKey(event.sessionId, event.toolCallId));
		if (!pending || pending.toolName !== event.toolName) return;
		await publish("permission_request", ctx, {
			tool_name: pending.toolName,
			tool_call_id: event.toolCallId,
			tool_input: pending.input,
			approval_mode: event.approvalMode,
		});
	});

	api.on("tool_approval_resolved", event => {
		toolCalls.delete(toolKey(event.sessionId, event.toolCallId));
	});

	api.on("session_stop", async (event, ctx) => {
		if (event.session_id !== sessionId(ctx) || event.stop_hook_active) return undefined;
		return stopReply(
			await publish(
				"stop",
				ctx,
				{ turn_id: event.turn_id },
				event.signal,
			),
			stopResponse,
		);
	});

	api.on("session_shutdown", () => {
		toolCalls.clear();
	});
}
