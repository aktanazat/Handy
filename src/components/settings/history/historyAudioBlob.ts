import { invoke } from "@tauri-apps/api/core";

type HistoryAudioChunk = {
  bytes: number[];
  eof: boolean;
};

/* One stored recording, read chunk by chunk into a WAV blob. The stream pulls
 * only as fast as the blob is assembled, so a long recording never sits in
 * memory twice, and a run that ends without a byte returns null rather than an
 * empty blob the player would try to play. */
export const loadHistoryAudioBlob = async (
  historyId: number,
): Promise<Blob | null> => {
  let offset = 0;
  let receivedBytes = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await invoke<HistoryAudioChunk>(
          "read_history_audio_chunk",
          { historyId, offset },
        );
        const bytes = new Uint8Array(chunk.bytes);
        if (bytes.byteLength > 0) {
          receivedBytes = true;
          offset += bytes.byteLength;
          controller.enqueue(bytes);
        }
        if (chunk.eof) {
          controller.close();
        } else if (bytes.byteLength === 0) {
          controller.error(
            new Error("History audio ended before the next chunk"),
          );
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
  const blob = await new Response(stream, {
    headers: { "Content-Type": "audio/wav" },
  }).blob();

  return receivedBytes ? blob : null;
};
