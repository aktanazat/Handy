import React from "react";
import { useTranslation } from "react-i18next";
import { formatModelSize } from "@/lib/utils/format";
import {
  SettingsDisclosure,
  SettingsLinkRow,
  SettingsSection,
} from "@/components/settings/rows";
import { useModelStore } from "@/stores/modelStore";
import { PostProcessingSettingsApi } from "../PostProcessingSettingsApi";
import { CloudSttProviderSettings } from "../models/CloudSttProviderSettings";
import { diskUsage } from "../models/modelCatalog";

/* Where models are chosen and what they may talk to.
 *
 * Model choice is automatic now — the sidebar chip that used to state it is
 * gone — so this section is a door to the catalog rather than a copy of it,
 * with the disk cost as the fact that decides whether you open it.
 *
 * The two credential blocks below it are one-time setups, so they are rows
 * until a reader needs them: a cloud transcription key and a remote cleanup
 * endpoint are things you configure once, and laid out flat they would bury
 * every setting around them. */
export const AdvancedModels: React.FC<{ onOpenCatalog: () => void }> = ({
  onOpenCatalog,
}) => {
  const { t } = useTranslation();
  const models = useModelStore((state) => state.models);
  const onDisk = diskUsage(models);

  return (
    <SettingsSection label={t("settingsV2.advanced.models")}>
      <SettingsLinkRow
        label={t("settingsV2.advanced.modelCatalog")}
        action={t("common.open")}
        fact={
          onDisk.count > 0
            ? `${t("settings.models.familyCount", { total: onDisk.count })} \u00b7 ${formatModelSize(onDisk.sizeMb)}`
            : undefined
        }
        onOpen={onOpenCatalog}
      />
      <SettingsDisclosure label={t("settingsV2.advanced.cloudKeys")}>
        <CloudSttProviderSettings />
      </SettingsDisclosure>
      <SettingsDisclosure label={t("settingsV2.advanced.cleanupProvider")} lazy>
        <PostProcessingSettingsApi />
      </SettingsDisclosure>
    </SettingsSection>
  );
};
