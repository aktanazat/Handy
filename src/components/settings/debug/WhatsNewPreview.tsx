import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingsRow } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { WhatsNewModal } from "../../whats-new/WhatsNewModal";
import { findLatestReleaseNote } from "../../whats-new/releaseNotes";
import type { ReleaseNote } from "../../whats-new/releaseNotes";

export const WhatsNewPreview: React.FC = () => {
  const { t } = useTranslation();
  const [note, setNote] = useState<ReleaseNote | null>(null);

  const preview = () => {
    try {
      const releaseNote = findLatestReleaseNote();

      if (!releaseNote) {
        toast.info(t("settings.debug.whatsNewPreview.noNotes"));
        return;
      }

      setNote(releaseNote);
    } catch (error) {
      console.error("Failed to preview release notes:", error);
      toast.error(t("settings.debug.whatsNewPreview.error"));
    }
  };

  return (
    <>
      {/* The row already says "Preview", so the button only has to say which
       * direction it goes. */}
      <SettingsRow
        label={t("settings.debug.whatsNewPreview.title")}
        hint={t("settings.debug.whatsNewPreview.description")}
      >
        <Button variant="outline" size="sm" onClick={preview}>
          {t("common.open")}
        </Button>
      </SettingsRow>

      {note && (
        <WhatsNewModal
          note={note}
          open={true}
          onDismiss={() => setNote(null)}
        />
      )}
    </>
  );
};
