import React, { useState } from "react";
import { ChevronDown, FileText, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Document } from "@/bindings";
import {
  Microlabel,
  Notice,
  SettingsSection,
} from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { formatEntryTimestamp } from "@/lib/utils/format";
import { EmptyStateRow } from "./EmptyStateRow";
import { PeopleConfirmDialog } from "./PeopleConfirmDialog";

interface PersonDocumentsProps {
  documents: Document[];
  loadFailed: boolean;
  pending: boolean;
  onImport: () => void;
  onDelete: (document: Document) => void;
}

export const PersonDocuments: React.FC<PersonDocumentsProps> = ({
  documents,
  loadFailed,
  pending,
  onImport,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState<Document | null>(null);

  return (
    <SettingsSection
      label={t("people.detail.documents")}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onImport}
        >
          <FileText aria-hidden="true" />
          {t("people.detail.importDocument")}
        </Button>
      }
    >
      {loadFailed ? (
        <div className="px-4 py-3">
          <Notice tone="danger">{t("people.detail.documentsLoadError")}</Notice>
        </div>
      ) : documents.length === 0 ? (
        <EmptyStateRow icon={FileText}>
          {t("people.detail.noDocuments")}
        </EmptyStateRow>
      ) : (
        <ul className="divide-y divide-gray-alpha-400">
          {documents.map((document) => (
            <li
              key={document.summary.id}
              data-slot="person-document"
              className="flex items-start gap-2 px-4 py-3"
            >
              <details className="group min-w-0 flex-1">
                <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <FileText
                    aria-hidden="true"
                    className="mt-0.5 size-4 flex-none text-gray-700"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-gray-1000">
                      {document.summary.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Microlabel className="normal-case">
                        {document.summary.source_name}
                      </Microlabel>
                      <Microlabel className="normal-case tabular-nums">
                        {formatEntryTimestamp(
                          document.summary.created_at_utc_ms,
                        )}
                      </Microlabel>
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="mt-0.5 size-4 flex-none text-gray-700 transition-transform group-open:rotate-180"
                  />
                </summary>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap border-t border-gray-alpha-400 pt-3 font-mono text-[11px] leading-5 text-gray-900 select-text">
                  {document.content}
                </pre>
              </details>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-mt-1 -me-1 text-red-900 hover:text-red-900"
                aria-label={t("people.detail.deleteDocument")}
                title={t("people.detail.deleteDocument")}
                disabled={pending}
                onClick={() => setDeleting(document)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <PeopleConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("people.detail.deleteDocumentTitle")}
        description={t("people.detail.deleteDocumentDescription", {
          document: deleting?.summary.title ?? "",
        })}
        confirmLabel={t("people.detail.deleteDocument")}
        pending={pending}
        destructive
        onConfirm={() => {
          if (deleting !== null) onDelete(deleting);
          setDeleting(null);
        }}
      />
    </SettingsSection>
  );
};
