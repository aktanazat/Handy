import type { Page } from "@playwright/test";

/* One Tauri event probe for the specs that need to watch native subscriptions.
 * `installTauriMock` plants the Tauri globals; this wraps them so a spec can
 * count the live listeners per event and deliver a payload to them.
 *
 * The bookkeeping id is whatever `plugin:event|listen` answers with, because
 * that is the value the API hands back to `unregisterListener` when a listener
 * is released (@tauri-apps/api/event.js:43-47). The mock answers with the
 * callback id it was given (tests/support/tauri-mock.ts:600-617); nothing here
 * relies on those two being the same number.
 */

export type TauriValue =
  | boolean
  | null
  | number
  | string
  | readonly TauriValue[]
  | { readonly [key: string]: TauriValue };
type TauriArguments = { readonly [key: string]: TauriValue };
type TauriEvent = { event: string; id: number; payload: TauriValue };
type TauriCallback = (event: TauriEvent) => void;
type TauriInternals = {
  invoke: (command: string, args?: TauriArguments) => Promise<TauriValue>;
  transformCallback: (callback?: TauriCallback) => number;
};
type TauriEventPluginInternals = {
  unregisterListener: (event: string, id: number) => void;
};
type SonaEventProbe = {
  emit: (event: string, payload: TauriValue) => void;
  listenerCounts: () => Record<string, number>;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__: TauriInternals;
    __TAURI_EVENT_PLUGIN_INTERNALS__: TauriEventPluginInternals;
    __sonaEventProbe?: SonaEventProbe;
  }
}

export interface EventProbeOptions {
  /** Commands answered with the backend's own error string, so a spec can walk
   * a real rejection path without standing up a second mock. */
  readonly rejectedCommands?: readonly string[];
}

export const installEventProbe = async (
  page: Page,
  { rejectedCommands = [] }: EventProbeOptions = {},
): Promise<void> => {
  await page.addInitScript(
    (rejected: readonly string[]) => {
      const callbacks = new Map<number, TauriCallback>();
      const handlers = new Map<number, TauriCallback>();
      const listeners = new Map<string, Set<number>>();
      const { transformCallback, invoke } = window.__TAURI_INTERNALS__;
      const { unregisterListener } = window.__TAURI_EVENT_PLUGIN_INTERNALS__;

      window.__TAURI_INTERNALS__.transformCallback = (callback) => {
        const id = transformCallback(callback);
        if (callback) callbacks.set(id, callback);
        return id;
      };
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (rejected.includes(command)) throw "permission_denied";
        if (command !== "plugin:event|listen") return invoke(command, args);
        const event = String(args?.event ?? "");
        const callback = callbacks.get(Number(args?.handler));
        const listenerId = Number(await invoke(command, args));
        if (callback !== undefined) handlers.set(listenerId, callback);
        const registered = listeners.get(event) ?? new Set<number>();
        registered.add(listenerId);
        listeners.set(event, registered);
        return listenerId;
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = (
        event,
        id,
      ) => {
        listeners.get(event)?.delete(id);
        handlers.delete(id);
        unregisterListener(event, id);
      };
      window.__sonaEventProbe = {
        emit: (event, payload) => {
          for (const id of listeners.get(event) ?? []) {
            handlers.get(id)?.({ event, id, payload });
          }
        },
        /* Released events are dropped rather than reported as zero, so a spec
         * can compare the whole map against the subscriptions it expects. */
        listenerCounts: () =>
          Object.fromEntries(
            Array.from(listeners)
              .filter(([, registered]) => registered.size > 0)
              .map(([event, registered]) => [event, registered.size]),
          ),
      };
    },
    [...rejectedCommands],
  );
};

export const emitTauriEvent = (
  page: Page,
  event: string,
  payload: TauriValue,
): Promise<void> =>
  page.evaluate(
    ({ eventName, eventPayload }) => {
      window.__sonaEventProbe?.emit(eventName, eventPayload);
    },
    { eventName: event, eventPayload: payload },
  );

export const listenerCounts = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => window.__sonaEventProbe?.listenerCounts() ?? {});

export const eventListenerCount = async (
  page: Page,
  event: string,
): Promise<number> => (await listenerCounts(page))[event] ?? 0;
