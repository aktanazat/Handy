import React, { useEffect, useRef, useState } from "react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";

interface HistoryAudioPlayerProps {
  historyId: number;
  totalSeconds: number | undefined;
  getAudioBlob: (historyId: number) => Promise<Blob | null>;
}

/* The player's anatomy belongs to the primitive; the row only spans it and
 * quiets it: gray-900 control, one tabular duration. The blob loads on the
 * first play and its object URL stays cached until the row unmounts. */
export const HistoryAudioPlayer: React.FC<HistoryAudioPlayerProps> = ({
  historyId,
  totalSeconds,
  getAudioBlob,
}) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const loadAudio = async () => {
    if (audioUrl) return audioUrl;

    const blob = await getAudioBlob(historyId);
    if (!blob) return null;

    // react-doctor-disable-next-line no-create-object-url-without-revoke
    const url = URL.createObjectURL(blob);
    if (!mountedRef.current) {
      URL.revokeObjectURL(url);
      return null;
    }
    setAudioUrl(url);
    return url;
  };

  return (
    <AudioPlayer
      onLoadRequest={loadAudio}
      totalSeconds={totalSeconds}
      /* Capped rather than full-bleed: the primitive's native range track is
       * the loudest thing it draws, and stretched across the row it outweighed
       * the transcript above it. At 420px it reads as a control under the text
       * instead of a rule through the row, and the tabular total sits beside
       * the scrubber instead of floating at the row's far edge. */
      className="w-full max-w-[420px] [&_button]:text-gray-900 [&_span]:text-gray-800 [&_span]:tabular-nums"
    />
  );
};
