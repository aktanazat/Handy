import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type AgentPanelCommandErrorV1,
  type AgentPanelPairingReceiptV1,
  type Result,
} from "@/bindings";
import { Button } from "@/components/vg/button";
import { Input } from "@/components/vg/input";
import { Notice, SettingsField, SettingsRow } from "@/components/settings/rows";
import { useSettings } from "@/hooks/useSettings";

/* Where the panel sends its turns, and the key it will believe when they come
 * back.
 *
 * Three fields and one button, because pairing is three facts and one question
 * the fields cannot answer: does it answer. The three facts are written when
 * you are done with a field — Enter, or leaving it — and the row at the top
 * says whether this Mac is paired, which is the receipt. Saving and testing
 * stay separate: a relay that is asleep is still the relay you paired with,
 * and a screen that refuses to keep an address it cannot reach right now is a
 * screen that cannot be used on a laptop.
 *
 * The private half of this Mac's identity never appears here. It lives in the
 * secret backend; the public half is shown so it can be added to the relay's
 * allowlist, which is the other half of the handshake and the one thing a
 * reader has to carry out of this screen by hand. */
export const SonaAgentPairing: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { getSetting, refreshSettings, settings } = useSettings();

  const savedUrl = getSetting("agent_panel_relay_url") ?? "";
  const savedKeyId = getSetting("agent_panel_relay_key_id") ?? "";
  const savedPublicKey = getSetting("agent_panel_relay_public_key") ?? "";
  const paired = getSetting("agent_panel_paired") ?? false;
  /* The stored timestamp is written in exactly one place — the Test button's
   * command — so it is the last successful *test*, not the last turn. Turns do
   * not stamp it on purpose: `update_settings` bumps `settings_revision`, and
   * a bump on the turn that produced a settings proposal would make that
   * proposal stale before its Apply. */
  const lastTested =
    getSetting("agent_panel_last_successful_connection_at") ?? null;

  const [relayUrl, setRelayUrl] = useState(savedUrl);
  const [relayKeyId, setRelayKeyId] = useState(savedKeyId);
  const [relayPublicKey, setRelayPublicKey] = useState(savedPublicKey);
  const [identity, setIdentity] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reached, setReached] = useState(false);

  /* The store is the one copy of a saved pairing; these fields are a draft of
   * the next one. They re-seed whenever the saved value changes underneath —
   * after a save, after an unpair — and never fight the reader in between. */
  useEffect(() => {
    setRelayUrl(savedUrl);
    setRelayKeyId(savedKeyId);
    setRelayPublicKey(savedPublicKey);
  }, [savedUrl, savedKeyId, savedPublicKey]);

  useEffect(() => {
    let cancelled = false;
    void commands.agentPanelPublicIdentity().then(
      (result) => {
        if (cancelled) return;
        setIdentity(result.status === "ok" ? result.data.public_key : null);
      },
      () => {
        if (!cancelled) setIdentity(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /* Every button here is the same shape of act: mutate, then re-read the
   * store rather than patch a local copy of it. `reached` is the only thing
   * a receipt tells this screen that the settings do not. */
  const run = async (
    action: () => Promise<
      Result<AgentPanelPairingReceiptV1, AgentPanelCommandErrorV1>
    >,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setReached(false);
    try {
      const result = await action();
      if (result.status === "error") {
        setError(
          t(`settings.agents.sonaAgent.reason.${result.error}`, result.error),
        );
        return false;
      }
      await refreshSettings();
      return true;
    } catch (actionError) {
      setError(String(actionError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const complete =
    relayUrl.trim() !== "" &&
    relayKeyId.trim() !== "" &&
    relayPublicKey.trim() !== "";
  const changed =
    relayUrl !== savedUrl ||
    relayKeyId !== savedKeyId ||
    relayPublicKey !== savedPublicKey;
  const disabled = settings === null || busy;

  /* Leaving a field writes the three of them, because a pairing is one fact in
   * three parts and the backend takes it whole. Nothing is written until all
   * three are filled in and at least one differs from what is stored, so
   * tabbing through a saved pairing is silent and a half-filled one waits. */
  const commitPairing = () => {
    if (!complete || !changed || busy) return;
    void run(() =>
      commands.setAgentPanelPairing({
        relay_url: relayUrl,
        relay_key_id: relayKeyId,
        relay_public_key: relayPublicKey,
      }),
    );
  };

  /* Enter is the same act as leaving the field: it blurs, and blur commits. */
  const commitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  const test = async () => {
    setReached(await run(commands.agentPanelTestConnection));
  };

  const copyIdentity = async () => {
    if (!identity) return;
    try {
      await navigator.clipboard.writeText(identity);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (copyError) {
      setError(String(copyError));
    }
  };

  return (
    <>
      <SettingsRow
        label={t("settings.agents.sonaAgent.pairing")}
        fact={
          paired
            ? t("settings.agents.sonaAgent.paired")
            : t("settings.agents.sonaAgent.unpaired")
        }
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => void test()}
          disabled={disabled || !paired}
        >
          {t("settings.agents.sonaAgent.test")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void run(commands.clearAgentPanelPairing)}
          disabled={disabled || !paired}
        >
          {t("settings.agents.sonaAgent.unpair")}
        </Button>
      </SettingsRow>

      <SettingsRow
        label={t("settings.agents.sonaAgent.lastTested")}
        fact={
          lastTested !== null
            ? new Date(lastTested).toLocaleString(i18n.language)
            : t("settings.agents.sonaAgent.never")
        }
      />

      <SettingsField
        label={t("settings.agents.sonaAgent.relayUrl")}
        hint={t("settings.agents.sonaAgent.relayUrlHint")}
        controlId="sona-agent-relay-url"
      >
        <Input
          id="sona-agent-relay-url"
          type="text"
          inputMode="url"
          spellCheck={false}
          value={relayUrl}
          disabled={disabled}
          onChange={(event) => setRelayUrl(event.target.value)}
          onBlur={commitPairing}
          onKeyDown={commitOnEnter}
          placeholder="http://100.64.0.1:8650"
        />
      </SettingsField>

      <SettingsField
        label={t("settings.agents.sonaAgent.relayKeyId")}
        controlId="sona-agent-relay-key-id"
      >
        <Input
          id="sona-agent-relay-key-id"
          type="text"
          spellCheck={false}
          value={relayKeyId}
          disabled={disabled}
          onChange={(event) => setRelayKeyId(event.target.value)}
          onBlur={commitPairing}
          onKeyDown={commitOnEnter}
        />
      </SettingsField>

      <SettingsField
        label={t("settings.agents.sonaAgent.relayPublicKey")}
        controlId="sona-agent-relay-public-key"
      >
        <Input
          id="sona-agent-relay-public-key"
          type="text"
          spellCheck={false}
          className="w-full font-mono"
          value={relayPublicKey}
          disabled={disabled}
          onChange={(event) => setRelayPublicKey(event.target.value)}
          onBlur={commitPairing}
          onKeyDown={commitOnEnter}
        />
      </SettingsField>

      <SettingsField
        label={t("settings.agents.sonaAgent.identity")}
        hint={t("settings.agents.sonaAgent.identityHint")}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-gray-900">
            {identity ?? t("settings.agents.sonaAgent.identityUnavailable")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyIdentity()}
            disabled={identity === null}
          >
            {copied
              ? t("settings.agents.sonaAgent.copied")
              : t("settings.agents.sonaAgent.copy")}
          </Button>
        </div>
      </SettingsField>

      {(error !== null || reached) && (
        <div className="px-6 py-2.5">
          <Notice
            tone={error === null ? "muted" : "danger"}
            assertive={error !== null}
          >
            {error === null
              ? t("settings.agents.sonaAgent.reached")
              : `${t("settings.agents.sonaAgent.failed")} ${error}`}
          </Notice>
        </div>
      )}
    </>
  );
};
