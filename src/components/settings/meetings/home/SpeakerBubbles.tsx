import React from "react";

export const speakerInitials = (speaker: string) =>
  speaker
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase();

interface SpeakerBubblesProps {
  speakers: string[];
}

export const SpeakerBubbles: React.FC<SpeakerBubblesProps> = ({ speakers }) => {
  if (speakers.length === 0) return null;

  const visible = speakers.slice(0, speakers.length > 3 ? 2 : 3);
  const overflow = speakers.length > 3 ? speakers.length - 2 : 0;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="flex flex-none -space-x-1">
        {visible.map((speaker, index) => (
          <span
            key={`${speaker}:${index}`}
            data-slot="meeting-person"
            className="flex size-5 items-center justify-center rounded-full border border-background-100 bg-gray-300 text-[10px] text-gray-1000"
          >
            {speakerInitials(speaker)}
          </span>
        ))}
        {overflow > 0 ? (
          <span
            data-slot="meeting-person-overflow"
            className="flex size-5 items-center justify-center rounded-full border border-background-100 bg-gray-300 text-[10px] text-gray-1000"
          >
            +{overflow}
          </span>
        ) : null}
      </span>
      <span
        title={speakers.join(", ")}
        className="truncate text-[12px] text-gray-900"
      >
        {speakers.join(", ")}
      </span>
    </span>
  );
};
