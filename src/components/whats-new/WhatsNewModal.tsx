import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { MarkdownContent } from "./MarkdownContent";
import type { ReleaseNote } from "./releaseNotes";

interface WhatsNewModalProps {
  note: ReleaseNote;
  open: boolean;
  onDismiss: () => void;
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({
  note,
  open,
  onDismiss,
}) => {
  const { t } = useTranslation();
  /* The Debug preview removes this component in `onDismiss`. Keep the local
   * dialog alive through Radix's close-autofocus event, then dismiss it. */
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const dismissAfterCloseRef = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(open);

  useEffect(() => {
    setDialogOpen(open);
    if (open) dismissAfterCloseRef.current = false;
  }, [open]);

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(nextOpen) => {
        setDialogOpen(nextOpen);
        dismissAfterCloseRef.current = !nextOpen;
      }}
    >
      {/* `aria-describedby={undefined}` because a release note has no summary
       * line: the markdown body is the content, not a description of it, and
       * pointing the dialog at a missing element is what makes Radix complain.
       * The close button's accessible name comes from the primitive, which
       * reads the same `common.close` string this modal used to pass in. */}
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          focusReturnRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusReturnRef.current?.focus();
          focusReturnRef.current = null;
          if (dismissAfterCloseRef.current) {
            dismissAfterCloseRef.current = false;
            onDismiss();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t("whatsNew.title", { version: note.version })}
          </DialogTitle>
        </DialogHeader>
        {/* A note is as long as its release was, and a vertically centred
         * dialog that outgrows the viewport loses both ends at once. The body
         * scrolls; the title stays put. */}
        <div className="max-h-[60vh] overflow-y-auto">
          <MarkdownContent markdown={note.markdown} />
        </div>
      </DialogContent>
    </Dialog>
  );
};
