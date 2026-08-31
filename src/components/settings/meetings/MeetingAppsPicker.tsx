import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Notice, SettingsField } from "@/components/settings/rows";
import { Button } from "@/components/vg/button";
import { Checkbox } from "@/components/vg/checkbox";
import { Input } from "@/components/vg/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/vg/dialog";
import { useDetectionEditor } from "./MeetingDetectionSettings";

/* The apps detection knows by name.
 *
 * `writes` is what ticking the box stores, and it is exactly what the backend
 * seeds itself with (src-tauri/src/meeting/detection/apps.rs
 * DEFAULT_MEETING_APP_BUNDLE_IDS) — Teams ships two identifiers because
 * Microsoft renamed it once and both builds are in the wild. `matches` is
 * wider than `writes` only where the activation observer recognises further
 * identifiers for the same product (meeting_macos.rs), so a list carrying one
 * of those still reads as that app being on rather than as a stray entry.
 *
 * FaceTime is recognised by the observer but is not in the shipped allowlist,
 * so its box starts empty. Browsers are absent on purpose: the browser path is
 * a frontmost-tab reading, not an allowlist entry, which is what the caption
 * under the list says. */
interface KnownMeetingApp {
  /** Names the translation key and the checkbox id; never shown raw. */
  id: string;
  writes: readonly string[];
  matches: readonly string[];
}

const KNOWN_MEETING_APPS: readonly KnownMeetingApp[] = [
  { id: "zoom", writes: ["us.zoom.xos"], matches: ["us.zoom.xos"] },
  {
    id: "teams",
    writes: ["com.microsoft.teams2", "com.microsoft.teams"],
    matches: ["com.microsoft.teams2", "com.microsoft.teams"],
  },
  {
    id: "webex",
    writes: ["com.webex.meetingmanager"],
    matches: [
      "com.webex.meetingmanager",
      "com.cisco.webex",
      "com.cisco.webexmeetingsapp",
    ],
  },
  {
    id: "facetime",
    writes: ["com.apple.facetime"],
    matches: ["com.apple.facetime"],
  },
  {
    id: "slack",
    writes: ["com.tinyspeck.slackmacgap"],
    matches: ["com.tinyspeck.slackmacgap"],
  },
];

const KNOWN_BUNDLE_IDS: readonly string[] = KNOWN_MEETING_APPS.flatMap(
  (app) => app.matches,
);

/* The format the backend normalises to: trimmed, lowercased, one identifier
 * per entry (apps.rs `normalize_allowlist`). Validating the same shape here is
 * what lets the add sheet refuse a typo instead of storing an inert entry. */
const BUNDLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

interface AddAppSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: readonly string[];
  onAdd: (bundleId: string) => void;
}

/* Adding an app by identifier.
 *
 * This is a typed identifier rather than a file picker on purpose: the app
 * bundle's Info.plist is the only place its identifier lives, and nothing this
 * frontend can reach reads a file — the build grants `dialog:default` but no
 * filesystem permission, and no Tauri command returns a bundle's identifier.
 * A picker that returned "/Applications/Zoom.app" and then still demanded the
 * identifier would be an affordance that does not do its job. */
const AddAppSheet: React.FC<AddAppSheetProps> = ({
  open,
  onOpenChange,
  existing,
  onAdd,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const bundleId = draft.trim().toLowerCase();
  const malformed = bundleId.length > 0 && !BUNDLE_ID_PATTERN.test(bundleId);
  const duplicate = existing.includes(bundleId);
  const error = malformed
    ? t("settingsV2.apps.invalid")
    : duplicate
      ? t("settingsV2.apps.duplicate")
      : null;

  const submit = () => {
    if (bundleId.length === 0 || error !== null) return;
    onAdd(bundleId);
    setDraft("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDraft("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settingsV2.apps.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("settingsV2.apps.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label
            htmlFor="detection-add-app"
            className="text-[13px] text-gray-1000"
          >
            {t("settingsV2.apps.identifier")}
          </label>
          <Input
            id="detection-add-app"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("settingsV2.apps.identifierPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== null}
          />
          {error === null ? null : (
            <Notice tone="danger" assertive>
              {error}
            </Notice>
          )}
        </form>
        <DialogFooter showCloseButton>
          <Button
            type="button"
            onClick={submit}
            disabled={bundleId.length === 0 || error !== null}
          >
            {t("settingsV2.apps.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* Which applications count as a meeting, as a list of names rather than a
 * textarea of reverse-DNS identifiers.
 *
 * The stored value is unchanged — `meetingApps` is still the array of
 * lowercased bundle IDs `detection_settings_set` takes, written whole through
 * the shared editor. What changed is that the five products Sona already
 * recognises are boxes, and an identifier is only ever typed for the sixth. */
export const MeetingAppsPicker: React.FC = () => {
  const { t } = useTranslation();
  const { status, settings, saving, patch } = useDetectionEditor();
  const [adding, setAdding] = useState(false);

  const label = t("settingsV2.apps.label");
  const meetingApps = settings?.meetingApps ?? [];
  const running = status?.runningMeetingApps ?? [];
  const disabled = settings === null || !settings.enabled || saving;
  /* An entry nobody put behind a name: a renamed vendor identifier, or one
   * added here. It keeps its own row so removing it does not mean editing
   * a text blob. */
  const custom = meetingApps.filter(
    (bundleId) => !KNOWN_BUNDLE_IDS.includes(bundleId),
  );

  const write = (next: readonly string[]) =>
    void patch({ meetingApps: [...next] });

  return (
    /* No `controlId`: the control is a list of checkboxes, and a `<label for>`
     * pointing at a `<ul>` names nothing. The list carries the name itself. */
    <SettingsField
      label={label}
      disabled={settings === null || !settings.enabled}
    >
      <ul role="list" aria-label={label} className="flex flex-col gap-2">
        {KNOWN_MEETING_APPS.map((app) => {
          const checked = app.matches.some((bundleId) =>
            meetingApps.includes(bundleId),
          );
          const isRunning = app.matches.some((bundleId) =>
            running.includes(bundleId),
          );
          const name = t("settingsV2.apps.names." + app.id);
          return (
            <li key={app.id} className="flex items-center gap-2.5">
              <Checkbox
                id={"detection-app-" + app.id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(next) =>
                  write(
                    next === true
                      ? [
                          ...meetingApps,
                          ...app.writes.filter(
                            (bundleId) => !meetingApps.includes(bundleId),
                          ),
                        ]
                      : meetingApps.filter(
                          (bundleId) => !app.matches.includes(bundleId),
                        ),
                  )
                }
              />
              <label
                htmlFor={"detection-app-" + app.id}
                className="text-[13px] text-gray-1000"
              >
                {name}
              </label>
              {/* The fact that keeps an allowlist honest: an entry only ever
               * becomes evidence while that application is running. */}
              {isRunning ? (
                <span className="text-[13px] leading-5 text-gray-900">
                  {t("settingsV2.apps.runningNow")}
                </span>
              ) : null}
            </li>
          );
        })}
        {custom.map((bundleId) => (
          <li key={bundleId} className="flex items-center gap-2.5">
            <Checkbox
              id={"detection-app-" + bundleId}
              checked
              disabled={disabled}
              onCheckedChange={() =>
                write(meetingApps.filter((entry) => entry !== bundleId))
              }
            />
            <label
              htmlFor={"detection-app-" + bundleId}
              className="min-w-0 truncate text-[13px] text-gray-1000"
            >
              {bundleId}
            </label>
            {running.includes(bundleId) ? (
              <span className="text-[13px] leading-5 text-gray-900">
                {t("settingsV2.apps.runningNow")}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto text-red-900"
              aria-label={t("settingsV2.apps.remove", { app: bundleId })}
              disabled={disabled}
              onClick={() =>
                write(meetingApps.filter((entry) => entry !== bundleId))
              }
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {/* Said once, for the list: a call in a browser tab is noticed without
         * anything being listed here, so its absence is not a gap. */}
        <Notice tone="muted" live={false}>
          {t("settingsV2.apps.browsersAutomatic")}
        </Notice>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden="true" />
          {t("settingsV2.apps.add")}
        </Button>
      </div>
      <AddAppSheet
        open={adding}
        onOpenChange={setAdding}
        existing={meetingApps}
        onAdd={(bundleId) => write([...meetingApps, bundleId])}
      />
    </SettingsField>
  );
};
