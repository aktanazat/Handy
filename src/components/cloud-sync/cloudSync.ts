import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  commands,
  events,
  type CloudMeetingStatus,
  type CloudObjectState,
  type CloudPairingOffer,
  type CloudSyncErrorKind,
  type CloudSyncOverview,
  type MeetingSessionId,
  type Result,
} from "@/bindings";

export type CloudUiError =
  | CloudSyncErrorKind
  | "invalid_expiry"
  | "invalid_offer"
  | "unexpected";

interface CloudResource<T> {
  value: T | null;
  error: CloudUiError | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const subscribeToCloudSyncChanges = (
  onInvalidate: () => void,
): Promise<() => void> => events.cloudSyncChanged.listen(onInvalidate);
const useCloudResource = <T>(
  request: () => Promise<Result<T, CloudSyncErrorKind>>,
): CloudResource<T> => {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<CloudUiError | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const pendingRequestId = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    pendingRequestId.current = currentRequestId;
    setError(null);

    try {
      setLoading(true);
      const result = await request();
      if (requestId.current !== currentRequestId) return;
      if (result.status === "error") {
        setValue(null);
        setError(result.error);
        return;
      }
      setValue(result.data);
    } catch {
      if (requestId.current !== currentRequestId) return;
      setValue(null);
      setError("unexpected");
    } finally {
      setLoading(false);
      if (pendingRequestId.current === currentRequestId) {
        pendingRequestId.current = null;
      } else if (pendingRequestId.current !== null) {
        setLoading(true);
      }
    }
  }, [request]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    const subscribe = async () => {
      try {
        const listener = await subscribeToCloudSyncChanges(() => {
          if (!disposed) void refresh();
        });
        if (disposed) {
          listener();
          return;
        }
        unlisten = listener;
      } catch {
        if (!disposed) setError("unexpected");
      }
    };

    void refresh();
    void subscribe();
    return () => {
      disposed = true;
      requestId.current += 1;
      pendingRequestId.current = null;
      unlisten();
    };
  }, [refresh]);

  return { value, error, loading, refresh };
};

export const useCloudSyncOverview = (): CloudResource<CloudSyncOverview> => {
  const request = useCallback(() => commands.cloudSyncOverviewGet(), []);
  return useCloudResource(request);
};

export const useCloudMeetingStatus = (
  sessionId: MeetingSessionId,
): CloudResource<CloudMeetingStatus> => {
  const request = useCallback(
    () => commands.cloudSyncMeetingStatusGet(sessionId),
    [sessionId],
  );
  return useCloudResource(request);
};

export const isRetryableCloudState = (state: CloudObjectState): boolean =>
  state === "auth_required" ||
  state === "quota" ||
  state === "integrity_failure";

const cloudPairingOfferSchema = z.object({
  protocol_version: z.number().int().positive(),
  vault_id: z.string().min(1),
  device_id: z.string().min(1),
  signing_public_key: z.string().min(1),
  pairing_public_key: z.string().min(1),
  candidate_proof: z.string().min(1),
  pairing_nonce: z.string().min(1),
  expires_at_utc_ms: z.number().int().positive(),
  fingerprint: z.string().min(1),
});

export const parseCloudPairingOffer = (
  serializedOffer: string,
): CloudPairingOffer | null => {
  try {
    const parsedOffer = cloudPairingOfferSchema.safeParse(
      JSON.parse(serializedOffer),
    );
    return parsedOffer.success ? parsedOffer.data : null;
  } catch {
    return null;
  }
};

const padDatePart = (value: number): string => String(value).padStart(2, "0");

export const toLocalDateTimeValue = (date: Date): string =>
  String(date.getFullYear()) +
  "-" +
  padDatePart(date.getMonth() + 1) +
  "-" +
  padDatePart(date.getDate()) +
  "T" +
  padDatePart(date.getHours()) +
  ":" +
  padDatePart(date.getMinutes());

export const defaultCloudShareExpiry = (): string =>
  toLocalDateTimeValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

export const toCloudShareExpiryUtcMs = (value: string): number | null => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now()
    ? timestamp
    : null;
};
