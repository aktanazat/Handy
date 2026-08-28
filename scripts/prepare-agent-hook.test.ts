import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  configWithoutExternalBinaries,
  sidecarFilename,
  stageSidecar,
} from "./prepare-agent-hook";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "sona-agent-hook-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

describe("prepare-agent-hook", () => {
  test("uses Tauri's target-suffixed sidecar name", () => {
    expect(sidecarFilename("aarch64-apple-darwin")).toBe(
      "sona-agent-hook-aarch64-apple-darwin",
    );
  });

  test("adds the Windows executable suffix after the target triple", () => {
    expect(sidecarFilename("x86_64-pc-windows-msvc")).toBe(
      "sona-agent-hook-x86_64-pc-windows-msvc.exe",
    );
  });

  test("removes external binaries only for the helper Cargo build", () => {
    const config = JSON.parse(
      configWithoutExternalBinaries(
        JSON.stringify({
          bundle: {
            externalBin: ["binaries/sona-agent-hook"],
            resources: ["resources/**/*"],
          },
          build: { beforeBuildCommand: "bun run build" },
        }),
      ),
    );

    expect(config).toEqual({
      bundle: { externalBin: [], resources: ["resources/**/*"] },
      build: { beforeBuildCommand: "bun run build" },
    });
  });

  test("fails when Cargo did not produce the hook binary", () => {
    const directory = temporaryDirectory();
    const destination = join(directory, "binaries", "sona-agent-hook-test");

    expect(() =>
      stageSidecar(
        join(directory, "missing-hook"),
        destination,
        "aarch64-apple-darwin",
      ),
    ).toThrow("build output is missing");
    expect(existsSync(destination)).toBeFalse();
  });

  test("replaces a stale staged sidecar", () => {
    const directory = temporaryDirectory();
    const source = join(directory, "sona-agent-hook");
    const destination = join(directory, "binaries", "sona-agent-hook-test");
    writeExecutable(source, "current hook binary");
    mkdirSync(join(directory, "binaries"), { recursive: true });
    writeFileSync(destination, "stale hook binary");

    stageSidecar(source, destination, "aarch64-apple-darwin");

    expect(readFileSync(destination, "utf8")).toBe("current hook binary");
    expect(statSync(destination).mode & 0o111).not.toBe(0);
  });
});
