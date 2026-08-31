import * as React from "react";

export interface AuroraProps {
  isRecording: boolean;
}

/** Decorative capture-state wash. Recording motion is entirely CSS-driven. */
export const Aurora: React.FC<AuroraProps> = ({ isRecording }) => (
  <span
    aria-hidden="true"
    className="sona-aurora"
    data-recording={isRecording ? "true" : "false"}
  >
    <span className="sona-aurora__motion">
      <span className="sona-aurora__wash" />
    </span>
    <span className="sona-aurora__veil" />
  </span>
);
