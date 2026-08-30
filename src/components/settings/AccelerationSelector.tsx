import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../ui/SettingContainer";
import { Dropdown, type DropdownOption } from "../ui/Dropdown";
import { useSettings } from "../../hooks/useSettings";
import { commands } from "@/bindings";
import type {
  TranscribeAcceleratorSetting,
  OrtAcceleratorSetting,
} from "@/bindings";

const ORT_LABELS = {
  auto: "Auto",
  cpu: "CPU",
  cuda: "CUDA",
  directml: "DirectML",
  rocm: "ROCm",
} satisfies Record<OrtAcceleratorSetting, string>;

/* `AvailableAccelerators.ort` is a `Vec<String>` the backend builds by
 * stringifying transcribe_rs's own accelerator enum, so nothing guarantees a
 * value is one this app can store. Decode it rather than assert it: the
 * fallthrough group narrows `value` to exactly `OrtAcceleratorSetting`, and an
 * accelerator Sona has no setting for is dropped instead of being offered as a
 * choice `change_ort_accelerator_setting` would refuse. */
function decodeOrtAccelerator(value: string): OrtAcceleratorSetting | null {
  switch (value) {
    case "auto":
    case "cpu":
    case "cuda":
    case "directml":
    case "rocm":
      return value;
    default:
      return null;
  }
}

interface AccelerationSelectorProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

/**
 * transcribe.cpp dropdown encodes accelerator + device in a single value:
 *   "auto"       → accelerator=auto, gpu_device=null
 *   "cpu"        → accelerator=cpu,  gpu_device=null
 *   "gpu:<id>"   → accelerator=gpu, stable opaque device identity
 */
function encodeTranscribeValue(
  accelerator: TranscribeAcceleratorSetting,
  gpuDevice: string | null,
): string {
  if (accelerator === "cpu") return "cpu";
  if (accelerator === "gpu" && gpuDevice !== null) return `gpu:${gpuDevice}`;
  return "auto";
}

type TranscribeSelection = {
  accelerator: TranscribeAcceleratorSetting;
  gpuDevice: string | null;
};

function decodeTranscribeValue(value: string): TranscribeSelection {
  if (value === "cpu") return { accelerator: "cpu", gpuDevice: null };
  if (value.startsWith("gpu:")) {
    return { accelerator: "gpu", gpuDevice: value.slice(4) };
  }
  return { accelerator: "auto", gpuDevice: null };
}

export const AccelerationSelector: FC<AccelerationSelectorProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const [transcribeOptions, setTranscribeOptions] = useState<DropdownOption[]>(
    [],
  );
  const [ortOptions, setOrtOptions] = useState<
    DropdownOption<OrtAcceleratorSetting>[]
  >([]);

  useEffect(() => {
    commands.getAvailableAccelerators().then((available) => {
      // Build combined transcribe.cpp options: Auto, [GPU devices...], CPU
      const opts: DropdownOption[] = [];
      if (available.transcribe.includes("auto")) {
        opts.push({
          value: "auto",
          label: t("settings.advanced.acceleration.gpuDevice.auto"),
        });
      }

      if (available.transcribe.includes("gpu")) {
        for (const dev of available.gpu_devices) {
          const vramLabel =
            dev.total_vram_mb >= 1024
              ? `${(dev.total_vram_mb / 1024).toFixed(1)} GB`
              : `${dev.total_vram_mb} MB`;
          opts.push({
            value: `gpu:${dev.id}`,
            label: `${dev.name} (${vramLabel})`,
          });
        }
      }

      if (available.transcribe.includes("cpu")) {
        opts.push({ value: "cpu", label: "CPU" });
      }
      setTranscribeOptions(opts);

      const ortValues = available.ort.includes("auto")
        ? available.ort
        : ["auto", ...available.ort];
      setOrtOptions(
        ortValues
          .flatMap((value) => {
            const accelerator = decodeOrtAccelerator(value);
            return accelerator === null ? [] : [accelerator];
          })
          .map((accelerator) => ({
            value: accelerator,
            label: ORT_LABELS[accelerator],
          })),
      );
    });
  }, [t]);

  const currentAccelerator = getSetting("transcribe_accelerator") ?? "auto";
  const currentGpuDevice = getSetting("transcribe_gpu_device") ?? null;
  const currentTranscribe = encodeTranscribeValue(
    currentAccelerator,
    currentGpuDevice,
  );
  const displayedTranscribe = transcribeOptions.some(
    (option) => option.value === currentTranscribe,
  )
    ? currentTranscribe
    : (transcribeOptions[0]?.value ?? null);
  const currentOrt = getSetting("ort_accelerator") ?? "auto";

  const handleTranscribeChange = async (value: string) => {
    const { accelerator, gpuDevice } = decodeTranscribeValue(value);
    // Save the device first to avoid `gpu + null` being normalized to Auto.
    await updateSetting("transcribe_gpu_device", gpuDevice);
    await updateSetting("transcribe_accelerator", accelerator);
  };

  return (
    <>
      <SettingContainer
        title={t("settings.advanced.acceleration.transcribe.title")}
        description={t("settings.advanced.acceleration.transcribe.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="horizontal"
      >
        <Dropdown
          options={transcribeOptions}
          selectedValue={displayedTranscribe}
          onSelect={handleTranscribeChange}
          disabled={
            isUpdating("transcribe_accelerator") ||
            isUpdating("transcribe_gpu_device")
          }
        />
      </SettingContainer>
      {ortOptions.length > 2 && (
        <SettingContainer
          title={t("settings.advanced.acceleration.ort.title")}
          description={t("settings.advanced.acceleration.ort.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
          layout="horizontal"
        >
          <Dropdown<OrtAcceleratorSetting>
            options={ortOptions}
            selectedValue={currentOrt}
            onSelect={(value) => updateSetting("ort_accelerator", value)}
            disabled={isUpdating("ort_accelerator")}
          />
        </SettingContainer>
      )}
    </>
  );
};
