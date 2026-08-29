import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import { ModelCatalogRow, type ModelRowState } from "./ModelCatalogRow";

const localeFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "i18n",
  "locales",
  "en",
  "translation.json",
);

/* Inline resources initialise synchronously, so no beforeAll hook is needed
 * (the repo's bun:test shim does not declare one). */
const i18n = createInstance();
void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: JSON.parse(fs.readFileSync(localeFile, "utf8")) },
  },
  interpolation: { escapeValue: false },
});

const BASE: ModelInfo = {
  id: "handy-computer/whisper-medium-gguf/whisper-medium-Q5_K_M.gguf",
  name: "Whisper Medium",
  description: "Accurate multilingual transcription.",
  filename: "whisper-medium-Q5_K_M.gguf",
  source: {
    HuggingFace: {
      repo_id: "handy-computer/whisper-medium-gguf",
      revision: "main",
    },
  },
  size_mb: 1536,
  is_downloaded: false,
  is_downloading: false,
  partial_size: 0,
  is_directory: false,
  engine_type: "TranscribeCpp",
  accuracy_score: 0.9,
  speed_score: 0.5,
  supports_translation: true,
  is_recommended: true,
  supported_languages: ["en", "de", "fr"],
  supports_language_selection: true,
  is_custom: false,
  supports_streaming: true,
  supports_language_detection: true,
};

interface RenderOptions {
  model?: Partial<ModelInfo>;
  state: ModelRowState;
  inMemory?: boolean;
  percentage?: number;
  speed?: number;
  error?: string;
  showQuant?: boolean;
}

const render = (options: RenderOptions): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ul>
        <ModelCatalogRow
          model={{ ...BASE, ...options.model }}
          state={options.state}
          inMemory={options.inMemory ?? false}
          percentage={options.percentage}
          speed={options.speed}
          error={options.error}
          showQuant={options.showQuant ?? false}
          onDownload={() => undefined}
          onCancel={() => undefined}
          onDelete={() => undefined}
          onActivate={() => undefined}
          onRetry={() => undefined}
        />
      </ul>
    </I18nextProvider>,
  );

describe("ModelCatalogRow status text", () => {
  test("every state reads as words, never as color alone", () => {
    const expected: [ModelRowState, string][] = [
      ["not-downloaded", "Not downloaded"],
      ["downloaded", "Downloaded"],
      ["active", "Active"],
      ["verifying", "Verifying…"],
      ["extracting", "Extracting…"],
      ["loading", "Loading…"],
    ];
    for (const [state, text] of expected) {
      expect(render({ state })).toContain(text);
    }
  });

  test("the active row distinguishes selected from resident in memory", () => {
    expect(render({ state: "active", inMemory: true })).toContain(
      "Active, in memory",
    );
    expect(render({ state: "active", inMemory: false })).toContain(">Active<");
  });

  test("a download reports its own percentage", () => {
    const html = render({ state: "downloading", percentage: 42.4 });
    expect(html).toContain("Downloading 42%");
  });
});

describe("ModelCatalogRow actions", () => {
  test("a model not on disk offers exactly one action: download", () => {
    const html = render({ state: "not-downloaded" });
    expect(html).toContain(">Download<");
    expect(html.includes(">Delete<")).toBe(false);
    expect(html.includes(">Use<")).toBe(false);
  });

  test("a download in flight can be cancelled and nothing else", () => {
    const html = render({ state: "downloading", percentage: 10 });
    expect(html).toContain("Cancel download");
    expect(html.includes(">Download<")).toBe(false);
    expect(html.includes(">Delete<")).toBe(false);
  });

  test("a downloaded model can be activated or deleted", () => {
    const html = render({ state: "downloaded" });
    expect(html).toContain(">Use<");
    expect(html).toContain(">Delete<");
  });

  test("the active model can be deleted but not re-activated", () => {
    const html = render({ state: "active" });
    expect(html).toContain(">Delete<");
    expect(html.includes(">Use<")).toBe(false);
  });

  test("delete is refused while the engine is loading that model", () => {
    const html = render({ state: "loading" });
    expect(html).toContain(">Delete<");
    expect(html).toContain("disabled");
  });

  test("verifying and extracting offer no destructive action mid-flight", () => {
    // SAFETY: both literals are members of the closed ModelRowState union; the
    // assertion only names the array's element type for the loop.
    for (const state of ["verifying", "extracting"] as ModelRowState[]) {
      const html = render({ state });
      expect(html.includes(">Delete<")).toBe(false);
      expect(html.includes(">Download<")).toBe(false);
    }
  });

  test("each control names the model it acts on", () => {
    // 85 rows all showing "Delete" would be indistinguishable to a screen
    // reader, so the accessible name carries the model.
    const downloaded = render({ state: "downloaded" });
    expect(downloaded).toContain('aria-label="Delete Whisper Medium"');
    expect(downloaded).toContain('aria-label="Use Whisper Medium"');
    expect(render({ state: "not-downloaded" })).toContain(
      'aria-label="Download Whisper Medium"',
    );
    expect(render({ state: "not-downloaded", error: "boom" })).toContain(
      'aria-label="Retry downloading Whisper Medium"',
    );
  });
});

describe("ModelCatalogRow download progress", () => {
  test("the bar is determinate and carries the reported value", () => {
    const html = render({ state: "downloading", percentage: 63 });
    expect(html).toContain('value="63"');
    expect(html).toContain('max="100"');
  });

  test("speed is shown only once it has been measured", () => {
    expect(
      render({ state: "downloading", percentage: 5, speed: 3.25 }),
    ).toContain("3.3 MB/s");
    expect(
      render({ state: "downloading", percentage: 5, speed: 0 }).includes(
        "MB/s",
      ),
    ).toBe(false);
  });
});

describe("ModelCatalogRow failures", () => {
  test("a hash or transfer failure stays on the row with a retry", () => {
    const html = render({
      state: "not-downloaded",
      error: "Checksum mismatch for whisper-medium-Q5_K_M.gguf",
    });
    expect(html).toContain("Checksum mismatch for whisper-medium-Q5_K_M.gguf");
    expect(html).toContain(">Retry<");
    // The failed row does not also offer a bare Download; Retry is the action.
    expect(html.includes(">Download<")).toBe(false);
  });

  test("an error on a downloaded model still allows use and delete", () => {
    const html = render({ state: "downloaded", error: "Extraction failed" });
    expect(html).toContain("Extraction failed");
    expect(html).toContain(">Use<");
    expect(html).toContain(">Delete<");
  });
});

describe("ModelCatalogRow metadata", () => {
  test("size, language reach and capabilities are all on the row", () => {
    const html = render({ state: "not-downloaded" });
    expect(html).toContain("1.5 GB");
    expect(html).toContain("3 languages");
    expect(html).toContain("Streaming");
    expect(html).toContain("Translate");
  });

  test("a single-language model names that language", () => {
    const html = render({
      state: "not-downloaded",
      model: { supported_languages: ["en"] },
    });
    expect(html).toContain("English only");
  });

  test("editorial and provenance tags render as text", () => {
    expect(render({ state: "not-downloaded" })).toContain("Recommended");
    expect(
      render({
        state: "downloaded",
        model: {
          is_custom: true,
          is_recommended: false,
          source: "Local",
          filename: "my-model.gguf",
        },
      }),
    ).toContain("Custom");
    expect(
      render({
        state: "downloaded",
        model: {
          is_recommended: false,
          source: { Url: { url: "https://blob/ggml-small.bin", sha256: null } },
        },
      }),
    ).toContain("Legacy");
  });

  test("the quant label appears only in debug mode", () => {
    expect(render({ state: "not-downloaded", showQuant: true })).toContain(
      "Q5_K_M",
    );
    expect(
      render({ state: "not-downloaded", showQuant: false }).includes("Q5_K_M"),
    ).toBe(false);
  });
});
