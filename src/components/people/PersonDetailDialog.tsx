import React from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/components/vg/dialog";
import { PersonDetailScreen } from "./PersonDetailScreen";

interface PersonDetailDialogProps {
  personId: string | null;
  onPersonChange: (personId: string) => void;
  onClose: () => void;
}

export const PersonDetailDialog: React.FC<PersonDetailDialogProps> = ({
  personId,
  onPersonChange,
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <Dialog
      open={personId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto p-0 sm:max-w-[840px]">
        <DialogTitle className="sr-only">
          {t("people.review.personDetails")}
        </DialogTitle>
        {personId === null ? null : (
          <PersonDetailScreen
            key={personId}
            personId={personId}
            onBack={onClose}
            onPersonChange={onPersonChange}
            onDeleted={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
