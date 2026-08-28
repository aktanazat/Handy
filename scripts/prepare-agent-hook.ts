import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  rmSync,
  statSync,
  type Stats,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const BINARY_NAME = "sona-agent-hook";
const ROOT = resolve(import.meta.dirname, "..");

type Environment = Record<string, string | undefined>;

export function sidecarFilename(targetTriple: string): string {
  const suffix = targetTriple.includes("-windows-") ? ".exe" : "";
  return `${BINARY_NAME}-${targetTriple}${suffix}`;
}

function validateTargetTriple(targetTriple: string): string {
  const normalized = targetTriple.trim();
  if (!normalized || normalized !== targetTriple) {
    throw new Error("a non-empty Cargo target triple is required");
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(
      "the Cargo target triple must not contain a path separator",
    );
  }
  return normalized;
}

export function resolveTargetTriple(
  arguments_: readonly string[],
  environment: Environment = process.env,
): string {
  const target = arguments_[0] ?? environment.TAURI_ENV_TARGET_TRIPLE ?? "";
  return validateTargetTriple(target);
}

type TauriConfigOverride = Record<string, unknown> & {
  bundle?: Record<string, unknown>;
};

export function configWithoutExternalBinaries(configOverride?: string): string {
  const config = configOverride
    ? (JSON.parse(configOverride) as TauriConfigOverride)
    : {};
  return JSON.stringify({
    ...config,
    bundle: {
      ...(config.bundle ?? {}),
      externalBin: [],
    },
  });
}

export function assertBuiltExecutable(
  path: string,
  targetTriple: string,
): void {
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch {
    throw new Error(`sona-agent-hook build output is missing: ${path}`);
  }

  if (!metadata.isFile()) {
    throw new Error(
      `sona-agent-hook build output is not a regular file: ${path}`,
    );
  }
  if (metadata.size === 0) {
    throw new Error(`sona-agent-hook build output is empty: ${path}`);
  }
  if (!targetTriple.includes("-windows-")) {
    try {
      accessSync(path, constants.X_OK);
    } catch {
      throw new Error(
        `sona-agent-hook build output is not executable: ${path}`,
      );
    }
  }
}

export function stageSidecar(
  source: string,
  destination: string,
  targetTriple: string,
): void {
  assertBuiltExecutable(source, targetTriple);
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { force: true });
  copyFileSync(source, destination);
  chmodSync(destination, statSync(source).mode & 0o777);
  assertBuiltExecutable(destination, targetTriple);
}

export function prepareAgentHook(targetTriple: string, root = ROOT): string {
  const target = validateTargetTriple(targetTriple);
  const result = Bun.spawnSync(
    ["cargo", "build", "--release", "--bin", BINARY_NAME, "--target", target],
    {
      cwd: join(root, "src-tauri"),
      env: {
        ...process.env,
        TAURI_CONFIG: configWithoutExternalBinaries(process.env.TAURI_CONFIG),
      },
      stdio: ["inherit", "inherit", "inherit"],
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(`cargo failed to build sona-agent-hook for ${target}`);
  }

  const source = join(
    root,
    "src-tauri",
    "target",
    target,
    "release",
    `${BINARY_NAME}${target.includes("-windows-") ? ".exe" : ""}`,
  );
  const destination = join(
    root,
    "src-tauri",
    "binaries",
    sidecarFilename(target),
  );
  stageSidecar(source, destination, target);
  return destination;
}

function main(): void {
  const target = resolveTargetTriple(process.argv.slice(2));
  const destination = prepareAgentHook(target);
  console.log(`[prepare-agent-hook] staged ${relative(ROOT, destination)}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[prepare-agent-hook] ${message}`);
    process.exitCode = 1;
  }
}
