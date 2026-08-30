import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
import { Button } from "@/components/vg/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { Skeleton } from "@/components/vg/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/vg/tabs";
import {
  Notice,
  SettingsPage,
  SettingsSurface,
} from "@/components/settings/rows";
import { ModeEditor } from "./ModeEditor";
import { ModesList } from "./ModesList";
import { ModesVocabularyView } from "./ModesVocabularyView";
import {
  DEFAULT_MODE_ID,
  MODE_MUTATION_ERROR_DEFAULTS,
  modeDefinitionFromView,
  modeWithRequiredCloudTimestamps,
  orderWithMove,
} from "./modeModel";

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

  /* Both reorder routes end here. The drag hands over the order it produced;
   * the move up/down menu items derive theirs from `orderWithMove`. One
   * command, one revision check, one snapshot back. */
  const commitOrder = useCallback(
    async (orderedIds: string[]) => {
      if (!snapshot) return;
      const current = snapshot.modes.map((mode) => mode.id);
      if (orderedIds.length !== current.length) return;
      if (orderedIds.every((id, index) => id === current[index])) return;
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

  if (loading) {
    return (
      <SettingsPage title={t("settings.modes.title")}>
        <div
          role="status"
          aria-label={t("settings.modes.loading")}
          className="flex flex-col gap-10"
        >
          <SettingsSurface>
            {SKELETON_ROWS.map((row) => (
              <div key={row} className="px-4 py-3">
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </SettingsSurface>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </SettingsPage>
    );
  }

  if (!snapshot) {
    return (
      <SettingsPage title={t("settings.modes.title")}>
        <div className="flex flex-col items-start gap-3">
          <Notice tone="danger">{t("settings.modes.loadError")}</Notice>
          {error ? <Notice>{error}</Notice> : null}
          <Button variant="outline" size="sm" onClick={() => void loadModes()}>
            {t("settings.modes.retry")}
          </Button>
        </div>
      </SettingsPage>
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
    <SettingsPage
      title={t("settings.modes.title")}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={saving || snapshot.modes.length === 0}
          onClick={() => {
            if (defaultMode) void createMode(defaultMode);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("settings.modes.new")}
        </Button>
      }
    >
      <Tabs
        value={workspaceView}
        onValueChange={(next) => {
          const view = WORKSPACE_VIEWS.find((candidate) => candidate === next);
          if (view) setWorkspaceView(view);
        }}
        className="gap-10"
      >
        {/* Line variant, matching SettingsHub: tabs that change what the page
         * shows are navigation; the segmented look stays reserved for value
         * filters like Library's Processed·Raw. */}
        <TabsList
          variant="line"
          aria-label={t("settings.modes.viewNavigation")}
        >
          {WORKSPACE_VIEWS.map((view) => (
            <TabsTrigger key={view} value={view}>
              {t(`settings.modes.views.${view}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="modes" className="flex flex-col gap-10">
          {error ? <Notice tone="danger">{error}</Notice> : null}

          {/* List above the editor rather than beside it: at the 760px column
           * a master/detail pane squeezes both, and stacking retires the whole
           * viewport-height calculation the two-pane layout needed. */}
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
            onActivate={(modeId) => void activateMode(modeId)}
            onDuplicate={(mode) => void createMode(mode)}
            onMove={(modeId, direction) =>
              void commitOrder(
                orderWithMove(
                  snapshot.modes.map((mode) => mode.id),
                  modeId,
                  direction,
                ),
              )
            }
            onReorder={(orderedIds) => void commitOrder(orderedIds)}
            onRequestDelete={setPendingDelete}
            onReload={() => void loadModes()}
          />

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
                void captureModeWebsiteActivation(selectedEditor.id, matchKind)
              }
              onRemoveWebsiteActivation={(host, matchKind) =>
                void removeModeWebsiteActivation(host, matchKind)
              }
            />
          ) : (
            <Notice>{t("settings.modes.empty")}</Notice>
          )}
        </TabsContent>

        <TabsContent value="vocabulary">
          <ModesVocabularyView />
        </TabsContent>
      </Tabs>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.modes.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.modes.deleteDescription", {
                mode: pendingDelete?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-gray-900">
            {t("settings.modes.deleteBody")}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingDelete(null)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void deleteMode()}
              disabled={saving}
            >
              {t("settings.modes.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
};
