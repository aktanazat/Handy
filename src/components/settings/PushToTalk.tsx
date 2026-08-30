import React from "react";
import { BooleanSettingRow } from "./BooleanSettingRow";

/* No hint: "Hold to record, release to stop" is the same gesture the tap/hold
 * tooltip on the transcribe binding already spells out, on the same page. */
export const PushToTalk: React.FC = React.memo(() => (
  <BooleanSettingRow
    settingKey="push_to_talk"
    labelKey="settings.general.pushToTalk.label"
  />
));
