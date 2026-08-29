use crate::audio_toolkit::text::{has_token_boundaries, lowercase_prefix_len};
use serde::{Deserialize, Serialize};
use specta::Type;

/// A user-authored text expansion. The trigger is matched on whole words after
/// vocabulary correction; the expansion is inserted verbatim.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Type)]
pub struct Snippet {
    pub id: String,
    pub trigger: String,
    pub expansion: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Snippet {
    pub fn trim_outer_whitespace(mut self) -> Self {
        self.trigger = self.trigger.trim().to_string();
        self.expansion = self.expansion.trim().to_string();
        self
    }

    pub fn is_usable(&self) -> bool {
        !self.trigger.is_empty() && !self.expansion.is_empty()
    }
}

/// One trigger prepared for matching. Triggers are compared through simple
/// lowercase folding rather than a regex, so trigger text can never be read as
/// pattern syntax.
struct PreparedSnippet<'a> {
    lowercase_trigger: String,
    expansion: &'a str,
}

/// Replaces enabled snippet triggers with their expansions. Matching is
/// case-insensitive, respects the same Unicode token boundaries as emoji
/// replacement, and prefers the longest trigger when several match at one
/// position.
pub fn apply_snippets(text: &str, snippets: &[Snippet]) -> String {
    if text.is_empty() {
        return text.to_string();
    }
    let prepared: Vec<PreparedSnippet<'_>> = snippets
        .iter()
        .filter(|snippet| snippet.enabled && snippet.is_usable())
        .map(|snippet| PreparedSnippet {
            lowercase_trigger: snippet.trigger.to_lowercase(),
            expansion: snippet.expansion.as_str(),
        })
        .collect();
    if prepared.is_empty() {
        return text.to_string();
    }

    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;

    for (start, _) in text.char_indices() {
        if start < cursor {
            continue;
        }
        let mut selected: Option<(usize, &str)> = None;
        for snippet in &prepared {
            let Some(length) = lowercase_prefix_len(&text[start..], &snippet.lowercase_trigger)
            else {
                continue;
            };
            let end = start + length;
            if has_token_boundaries(text, start, end)
                && selected.is_none_or(|(current, _)| length > current)
            {
                selected = Some((length, snippet.expansion));
            }
        }

        if let Some((length, expansion)) = selected {
            result.push_str(&text[cursor..start]);
            result.push_str(expansion);
            cursor = start + length;
        }
    }

    if cursor == 0 {
        return text.to_string();
    }
    result.push_str(&text[cursor..]);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippet(trigger: &str, expansion: &str) -> Snippet {
        Snippet {
            id: format!("snippet-{trigger}"),
            trigger: trigger.to_string(),
            expansion: expansion.to_string(),
            enabled: true,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn matches_trigger_case_insensitively() {
        let snippets = vec![snippet("addr", "1 Long Street")];

        assert_eq!(apply_snippets("addr", &snippets), "1 Long Street");
        assert_eq!(apply_snippets("ADDR", &snippets), "1 Long Street");
        assert_eq!(apply_snippets("Addr", &snippets), "1 Long Street");
    }

    #[test]
    fn expansion_case_is_preserved_verbatim() {
        let snippets = vec![snippet("sig", "Best,\nAktan")];

        assert_eq!(apply_snippets("SIG", &snippets), "Best,\nAktan");
    }

    #[test]
    fn only_whole_words_are_replaced() {
        let snippets = vec![snippet("addr", "1 Long Street")];

        assert_eq!(apply_snippets("addressed", &snippets), "addressed");
        assert_eq!(apply_snippets("xaddr", &snippets), "xaddr");
        assert_eq!(apply_snippets("addr_x", &snippets), "addr_x");
        assert_eq!(
            apply_snippets("send addr, please", &snippets),
            "send 1 Long Street, please"
        );
    }

    #[test]
    fn multi_word_triggers_match_as_phrases() {
        let snippets = vec![snippet("my address", "1 Long Street")];

        assert_eq!(
            apply_snippets("My Address is here", &snippets),
            "1 Long Street is here"
        );
        assert_eq!(apply_snippets("my addresses", &snippets), "my addresses");
    }

    #[test]
    fn longest_trigger_wins_at_the_same_position() {
        let snippets = vec![
            snippet("ship", "shipping"),
            snippet("ship it", "ship it now"),
        ];

        assert_eq!(apply_snippets("ship it", &snippets), "ship it now");
        assert_eq!(apply_snippets("ship", &snippets), "shipping");
    }

    #[test]
    fn disabled_snippets_are_skipped() {
        let mut disabled = snippet("addr", "1 Long Street");
        disabled.enabled = false;

        assert_eq!(apply_snippets("addr", &[disabled]), "addr");
    }

    #[test]
    fn blank_snippets_are_skipped() {
        let empty_expansion = snippet("addr", "");
        let empty_trigger = snippet("", "1 Long Street");

        assert_eq!(
            apply_snippets("addr here", &[empty_expansion, empty_trigger]),
            "addr here"
        );
    }

    #[test]
    fn every_occurrence_is_replaced() {
        let snippets = vec![snippet("addr", "1 Long Street")];

        assert_eq!(
            apply_snippets("addr and addr and ADDR", &snippets),
            "1 Long Street and 1 Long Street and 1 Long Street"
        );
    }

    #[test]
    fn expansions_are_never_rescanned() {
        let snippets = vec![snippet("a", "a b"), snippet("b", "loop")];

        assert_eq!(apply_snippets("a", &snippets), "a b");
    }

    #[test]
    fn trigger_text_is_never_read_as_a_pattern() {
        let snippets = vec![snippet("c++", "C plus plus")];

        assert_eq!(apply_snippets("c++", &snippets), "C plus plus");
        assert_eq!(apply_snippets("cxx", &snippets), "cxx");
    }

    #[test]
    fn non_ascii_triggers_fold_case_and_keep_boundaries() {
        let snippets = vec![snippet("straße", "Strasse")];

        assert_eq!(apply_snippets("STRASSE", &snippets), "STRASSE");
        assert_eq!(apply_snippets("Straße hier", &snippets), "Strasse hier");
        assert_eq!(apply_snippets("Straßeneck", &snippets), "Straßeneck");
    }

    #[test]
    fn text_without_matches_is_returned_unchanged() {
        let snippets = vec![snippet("addr", "1 Long Street")];

        assert_eq!(apply_snippets("nothing here", &snippets), "nothing here");
        assert_eq!(apply_snippets("", &snippets), "");
    }

    #[test]
    fn snippets_round_trip_through_serde() {
        let snippets = vec![snippet("addr", "1 Long Street")];
        let encoded = serde_json::to_value(&snippets).expect("snippets serialize");

        assert_eq!(
            encoded,
            serde_json::json!([{
                "id": "snippet-addr",
                "trigger": "addr",
                "expansion": "1 Long Street",
                "enabled": true,
                "created_at": 0,
                "updated_at": 0,
            }])
        );
        assert_eq!(
            serde_json::from_value::<Vec<Snippet>>(encoded).expect("snippets deserialize"),
            snippets
        );
    }
}
