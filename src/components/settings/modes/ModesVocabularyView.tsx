import React from "react";
import { CustomWords } from "../CustomWords";

/* The Vocabulary view of the Modes page. Global vocabulary lives here because
 * it is the counterpart to the per-mode vocabulary in the editor; the editor
 * pairs override these for one mode only.
 *
 * `CustomWords` brings its own labelled section, so this view is the tab panel
 * and nothing else — a heading here would name the same list twice. */
export const ModesVocabularyView: React.FC = () => <CustomWords />;
