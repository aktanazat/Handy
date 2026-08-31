import { useCallback, useEffect, useRef, useState } from "react";
import { events } from "@/bindings";

interface LoadedPeopleQuery<T> {
  key: string;
  value: T;
}

export const usePeopleQuery = <T>(key: string, query: () => Promise<T>) => {
  const [loaded, setLoaded] = useState<LoadedPeopleQuery<T> | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  const reload = useCallback(async () => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setFailedKey(null);

    try {
      const value = await query();
      if (requestGenerationRef.current !== requestGeneration) return;
      setLoaded({ key, value });
    } catch {
      if (requestGenerationRef.current !== requestGeneration) return;
      setFailedKey(key);
    }
  }, [key, query]);

  useEffect(() => {
    void reload();
    const subscriptions = Promise.all([
      events.meetingArtifactChanged.listen(() => void reload()),
      events.meetingRemoved.listen(() => void reload()),
    ]);

    return () => {
      requestGenerationRef.current += 1;
      void subscriptions.then((unlisteners) => {
        for (const unlisten of unlisteners) unlisten();
      });
    };
  }, [reload]);

  const data = loaded?.key === key ? loaded.value : null;
  return {
    data,
    error: failedKey === key,
    loading: data === null && failedKey !== key,
    reload,
  };
};
