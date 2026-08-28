import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type ModeDefinition,
  type ModeMutationError,
  type ModeSettingsSnapshot,
  type ModeView,
  type ModelInfo,
  type WebsiteHostMatch,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { useOsType } from "@/hooks/useOsType";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Skeleton,
  StatusText,
} from "@/components/ui";
import { ModeEditor } from "./ModeEditor";
import { ModesList } from "./ModesList";
import { ModesVocabularyView } from "./ModesVocabularyView";
import {
  DEFAULT_MODE_ID,
  MODE_MUTATION_ERROR_DEFAULTS,
  modeDefinitionFromView,
  modeWithRequiredCloudTimestamps,
} from "./modeModel";
import "../settings-density.css";
import "./modes.css";

const WORKSPACE_VIEWS = ["modes", "vocabulary"] as const;
const SKELETON_ROWS = [0, 1, 2, 3] as const;

export const ModesSettings: React.FC = () => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const osType = useOsType();
  const [snapshot, setSnapshot] = useState<ModeSettingsSnapshot | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<ModeDefinition | null>(null);
  const [workspaceView, setWorkspaceView] =
    useState<(typeof WORKSPACE_VIEWS)[number]>("modes");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ModeView | null>(null);
  const [capturingActivation, setCapturingActivation] = useState(false);

  const applySnapshot = useCallback(
    (next: ModeSettingsSnapshot) => {
      setSnapshot(next);
      void refreshSettings();
    },
    [refreshSettings],
  );

  const loadModes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applySnapshot(await commands.getModes());
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void loadModes();
  }, [loadModes]);

  useEffect(() => {
    let cancelled = false;
    void commands
      .getAvailableModels()
      .then((result) => {
        if (!cancelled && result.status === "ok") {
          setModels(result.data);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A stale-revision rejection must not throw away the draft the user is
  // editing. The snapshot refreshes so the next Save carries the current
  // revision; the editor keeps the unsaved changes and the conflict banner
  // tells the user to review before saving again.
  const reloadAfterConflict = useCallback(async () => {
    try {
      applySnapshot(await commands.getModes());
      setConflict(true);
    } catch (reloadError) {
      setError(String(reloadError));
    }
  }, [applySnapshot]);

  const handleMutationError = useCallback(
    async (mutationError: ModeMutationError) => {
      if (mutationError.kind === "stale_revision") {
        await reloadAfterConflict();
        return;
      }
      setError(
        t(
          `settings.modes.errors.${mutationError.kind}`,
          MODE_MUTATION_ERROR_DEFAULTS[mutationError.kind],
        ),
      );
    },
    [reloadAfterConflict, t],
  );

  const createMode = useCallback(
    async (source: ModeView) => {
      if (!snapshot) return;
      setSaving(true);
      setError(null);
      setConflict(false);
      const duplicate = modeDefinitionFromView(source);
      duplicate.id = `mode-${crypto.randomUUID()}`;
      duplicate.name = `${source.name} ${t("settings.modes.copySuffix")}`;
      try {
        const result = await commands.upsertMode(duplicate, snapshot.revision);
        if (result.status === "ok") {
          applySnapshot(result.data);
          const created = result.data.modes.find(
            (mode) => mode.id === duplicate.id,
          );
          setEditor(created ? modeDefinitionFromView(created) : duplicate);
        } else {
          await handleMutationError(result.error);
        }
      } catch (createError) {
        setError(String(createError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot, t],
  );

  const saveEditor = useCallback(
    async (draft: ModeDefinition) => {
      if (!snapshot) return;
      const nextEditor = modeWithRequiredCloudTimestamps(draft);
      if (nextEditor !== draft) setEditor(nextEditor);
      setSaving(true);
      setError(null);
      setConflict(false);
      try {
        const result = await commands.upsertMode(nextEditor, snapshot.revision);
        if (result.status === "ok") {
          applySnapshot(result.data);
          const saved = result.data.modes.find(
            (mode) => mode.id === nextEditor.id,
          );
          setEditor(saved ? modeDefinitionFromView(saved) : nextEditor);
        } else {
          await handleMutationError(result.error);
        }
      } catch (saveError) {
        setError(String(saveError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const activateMode = useCallback(
    async (modeIdToActivate: string) => {
      setSaving(true);
      setError(null);
      try {
        const result = await commands.setActiveMode(modeIdToActivate);
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          setError(String(result.error));
        }
      } catch (activationError) {
        setError(String(activationError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot],
  );

  const captureModeActivation = useCallback(
    async (modeIdToActivate: string) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.captureModeActivationRule(
          modeIdToActivate,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (captureError) {
        setError(String(captureError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const removeModeActivation = useCallback(
    async (appId: string) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.removeModeActivationRule(
          appId,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (removeError) {
        setError(String(removeError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const captureModeWebsiteActivation = useCallback(
    async (modeIdToActivate: string, matchKind: WebsiteHostMatch) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.captureModeWebsiteActivationRule(
          modeIdToActivate,
          matchKind,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (captureError) {
        setError(String(captureError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const removeModeWebsiteActivation = useCallback(
    async (host: string, matchKind: WebsiteHostMatch) => {
      if (!snapshot) return;
      setCapturingActivation(true);
      setError(null);
      try {
        const result = await commands.removeModeWebsiteActivationRule(
          host,
          matchKind,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (removeError) {
        setError(String(removeError));
      } finally {
        setCapturingActivation(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const reorder = useCallback(
    async (modeIdToMove: string, direction: -1 | 1) => {
      if (!snapshot) return;
      const currentIndex = snapshot.modes.findIndex(
        (mode) => mode.id === modeIdToMove,
      );
      const targetIndex = currentIndex + direction;
      if (
        currentIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= snapshot.modes.length
      ) {
        return;
      }
      const orderedIds = snapshot.modes.map((mode) => mode.id);
      [orderedIds[currentIndex], orderedIds[targetIndex]] = [
        orderedIds[targetIndex],
        orderedIds[currentIndex],
      ];
      setSaving(true);
      setError(null);
      try {
        const result = await commands.reorderModes(
          orderedIds,
          snapshot.revision,
        );
        if (result.status === "ok") {
          applySnapshot(result.data);
        } else {
          await handleMutationError(result.error);
        }
      } catch (reorderError) {
        setError(String(reorderError));
      } finally {
        setSaving(false);
      }
    },
    [applySnapshot, handleMutationError, snapshot],
  );

  const deleteMode = useCallback(async () => {
    if (!snapshot || !pendingDelete) return;
    setSaving(true);
    setError(null);
    try {
      const result = await commands.deleteMode(
        pendingDelete.id,
        snapshot.revision,
      );
      if (result.status === "ok") {
        applySnapshot(result.data);
        if (editor?.id === pendingDelete.id) setEditor(null);
        setPendingDelete(null);
      } else {
        await handleMutationError(result.error);
      }
    } catch (deleteError) {
      setError(String(deleteError));
    } finally {
      setSaving(false);
    }
  }, [applySnapshot, editor, handleMutationError, pendingDelete, snapshot]);

  const pageHeader = (
    <header className="settings-page-header">
      <h1 className="settings-page-title">{t("settings.modes.title")}</h1>
      <p className="settings-page-description">
        {t("settings.modes.description")}
      </p>
    </header>
  );

  if (loading) {
    return (
      <div className="settings-page modes-page density-page">
        {pageHeader}
        <div
          className="modes-workspace"
          role="status"
          aria-label={t("settings.modes.loading")}
        >
          <div className="modes-master flex flex-col gap-2 pt-2">
            {SKELETON_ROWS.map((row) => (
              <Skeleton key={row} className="h-9 w-full" />
            ))}
          </div>
          <div className="modes-detail-shell flex flex-col gap-3 pt-2">
            <Skeleton className="h-9 w-1/3" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="settings-page modes-page density-page">
        {pageHeader}
        <Alert
          variant="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadModes()}
            >
              {t("settings.modes.retry")}
            </Button>
          }
        >
          {t("settings.modes.loadError")}
        </Alert>
        {error ? <StatusText>{error}</StatusText> : null}
      </div>
    );
  }

  const defaultMode =
    snapshot.modes.find((mode) => mode.id === DEFAULT_MODE_ID) ??
    snapshot.modes[0];
  const activeMode =
    snapshot.modes.find((mode) => mode.id === snapshot.active_mode_id) ??
    defaultMode;
  const selectedEditor =
    editor ?? (activeMode ? modeDefinitionFromView(activeMode) : null);
  const savedSelectedMode = selectedEditor
    ? snapshot.modes.find((mode) => mode.id === selectedEditor.id)
    : undefined;

  return (
    <div className="settings-page modes-page density-page">
      {pageHeader}

      <nav
        className="settings-local-nav modes-view-nav"
        aria-label={t("settings.modes.viewNavigation")}
      >
        {WORKSPACE_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            aria-current={workspaceView === view ? "page" : undefined}
            onClick={() => setWorkspaceView(view)}
          >
            {t(`settings.modes.views.${view}`)}
          </button>
        ))}
      </nav>

      {error ? (
        <Alert
          variant="error"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setError(null)}
              aria-label={t("settings.modes.dismissError", "Dismiss the error")}
            >
              {t("common.close")}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {workspaceView === "vocabulary" ? (
        <ModesVocabularyView />
      ) : (
        <div className="modes-workspace">
          <ModesList
            modes={snapshot.modes}
            activeModeId={snapshot.active_mode_id}
            selectedModeId={selectedEditor?.id ?? null}
            busy={saving}
            osType={osType}
            onSelect={(mode) => {
              setEditor(modeDefinitionFromView(mode));
              setConflict(false);
            }}
            onCreate={() => {
              if (defaultMode) void createMode(defaultMode);
            }}
            onActivate={(modeId) => void activateMode(modeId)}
            onDuplicate={(mode) => void createMode(mode)}
            onMove={(modeId, direction) => void reorder(modeId, direction)}
            onRequestDelete={setPendingDelete}
            onReload={() => void loadModes()}
          />

          <section
            className="modes-detail-shell"
            aria-label={t("settings.modes.editorLabel")}
          >
            {selectedEditor ? (
              <ModeEditor
                mode={selectedEditor}
                savedMode={savedSelectedMode}
                modeCount={snapshot.modes.length}
                models={models}
                onChange={setEditor}
                onSave={() => void saveEditor(selectedEditor)}
                saving={saving}
                conflict={conflict}
                activationRules={snapshot.mode_activation_rules}
                websiteActivationRules={snapshot.mode_website_activation_rules}
                activationSupported={osType === "macos"}
                capturingActivation={capturingActivation}
                onCaptureActivation={() =>
                  void captureModeActivation(selectedEditor.id)
                }
                onRemoveActivation={(appId) => void removeModeActivation(appId)}
                onCaptureWebsiteActivation={(matchKind) =>
                  void captureModeWebsiteActivation(
                    selectedEditor.id,
                    matchKind,
                  )
                }
                onRemoveWebsiteActivation={(host, matchKind) =>
                  void removeModeWebsiteActivation(host, matchKind)
                }
              />
            ) : (
              <EmptyState
                title={t("settings.modes.empty")}
                description={t(
                  "settings.modes.emptyHint",
                  "Pick a mode on the left to change what it recognizes, rewrites and delivers.",
                )}
              />
            )}
          </section>
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("settings.modes.deleteTitle")}
        description={t("settings.modes.deleteDescription", {
          mode: pendingDelete?.name ?? "",
        })}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPendingDelete(null)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void deleteMode()}
              disabled={saving}
            >
              {t("settings.modes.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {t("settings.modes.deleteBody")}
        </p>
      </Dialog>
    </div>
  );
};
