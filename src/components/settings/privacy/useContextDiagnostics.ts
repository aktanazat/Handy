import { useCallback, useEffect, useState } from "react";
import { commands, type ContextDiagnostics } from "@/bindings";

/* What this build can actually read, as the backend last reported it. The
 * previous reading stays on screen while a refresh is in flight, so `loading`
 * and `value` are both live rather than one replacing the other. */
export interface ContextDiagnosticsResource {
  value: ContextDiagnostics | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export const useContextDiagnostics = (): ContextDiagnosticsResource => {
  const [diagnostics, setDiagnostics] = useState<ContextDiagnostics | null>(
    null,
  );
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true);

  const refreshDiagnostics = useCallback(async () => {
    setLoadingDiagnostics(true);
    setDiagnosticsError(null);
    try {
      setDiagnostics(await commands.getContextDiagnostics());
    } catch (error) {
      setDiagnosticsError(String(error));
    } finally {
      setLoadingDiagnostics(false);
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  return {
    value: diagnostics,
    error: diagnosticsError,
    loading: loadingDiagnostics,
    refresh: refreshDiagnostics,
  };
};
