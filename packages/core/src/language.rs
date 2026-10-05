use serde::Serialize;

/// A language offered by the preferred audio and subtitle pickers.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct Language {
    /// Stable code stored in preferences.
    pub code: &'static str,
    pub name: &'static str,
    /// Other codes for the same language: ISO 639-2 and legacy tags.
    #[serde(skip)]
    codes: &'static [&'static str],
    /// Lowercase names tracks use besides the English one.
    #[serde(skip)]
    names: &'static [&'static str],
}

const fn language(
    code: &'static str,
    name: &'static str,
    codes: &'static [&'static str],
    names: &'static [&'static str],
) -> Language {
    Language {
        code,
        name,
        codes,
        names,
    }
}

/// Every client builds its language pickers and track matching from this list.
const LANGUAGES: &[Language] = &[
    language("ar", "Arabic", &["ara"], &["العربية"]),
    language("bn", "Bengali", &["ben"], &["বাংলা"]),
    language("bg", "Bulgarian", &["bul"], &["български"]),
    language("ca", "Catalan", &["cat"], &["català"]),
    language(
        "zh",
        "Chinese",
        &["zho", "chi", "cmn"],
        &["中文", "简体中文", "繁體中文", "mandarin"],
    ),
    language("hr", "Croatian", &["hrv"], &["hrvatski"]),
    language("cs", "Czech", &["ces", "cze"], &["čeština", "cestina"]),
    language("da", "Danish", &["dan"], &["dansk"]),
    language("nl", "Dutch", &["nld", "dut"], &["nederlands"]),
    language("en", "English", &["eng"], &[]),
    language("et", "Estonian", &["est"], &["eesti"]),
    language("tl", "Filipino", &["fil", "tgl"], &["tagalog"]),
    language("fi", "Finnish", &["fin"], &["suomi"]),
    language("fr", "French", &["fra", "fre"], &["français", "francais"]),
    language("de", "German", &["deu", "ger"], &["deutsch"]),
    language("el", "Greek", &["ell", "gre"], &["ελληνικά"]),
    language("he", "Hebrew", &["heb", "iw"], &["עברית"]),
    language("hi", "Hindi", &["hin"], &["हिन्दी"]),
    language("hu", "Hungarian", &["hun"], &["magyar"]),
    language("is", "Icelandic", &["isl", "ice"], &["íslenska"]),
    language("id", "Indonesian", &["ind", "in"], &["indonesia"]),
    language("it", "Italian", &["ita"], &["italiano"]),
    language("ja", "Japanese", &["jpn"], &["日本語"]),
    language("kn", "Kannada", &["kan"], &["ಕನ್ನಡ"]),
    language("ko", "Korean", &["kor"], &["한국어"]),
    language("lv", "Latvian", &["lav"], &["latviešu"]),
    language("lt", "Lithuanian", &["lit"], &["lietuvių"]),
    language("ms", "Malay", &["msa", "may"], &["melayu"]),
    language("ml", "Malayalam", &["mal"], &["മലയാളം"]),
    language("mr", "Marathi", &["mar"], &["मराठी"]),
    language(
        "no",
        "Norwegian",
        &["nor", "nb", "nob", "nn", "nno"],
        &["norsk"],
    ),
    language("fa", "Persian", &["fas", "per"], &["farsi", "فارسی"]),
    language("pl", "Polish", &["pol"], &["polski"]),
    language("pt", "Portuguese", &["por"], &["português", "portugues"]),
    language("pa", "Punjabi", &["pan"], &["ਪੰਜਾਬੀ"]),
    language("ro", "Romanian", &["ron", "rum"], &["română", "romana"]),
    language("ru", "Russian", &["rus"], &["русский"]),
    language("sr", "Serbian", &["srp"], &["srpski", "српски"]),
    language("sk", "Slovak", &["slk", "slo"], &["slovenčina"]),
    language("sl", "Slovenian", &["slv"], &["slovenščina"]),
    language(
        "es",
        "Spanish",
        &["spa"],
        &["español", "espanol", "castellano"],
    ),
    language("sv", "Swedish", &["swe"], &["svenska"]),
    language("ta", "Tamil", &["tam"], &["தமிழ்"]),
    language("te", "Telugu", &["tel"], &["తెలుగు"]),
    language("th", "Thai", &["tha"], &["ไทย"]),
    language("tr", "Turkish", &["tur"], &["türkçe", "turkce"]),
    language("uk", "Ukrainian", &["ukr"], &["українська"]),
    language("ur", "Urdu", &["urd"], &["اردو"]),
    language("vi", "Vietnamese", &["vie"], &["việt"]),
];

/// ISO 639 placeholders that say nothing about the language.
const UNDETERMINED: &[&str] = &["und", "unk", "mul", "mis", "zxx"];

fn by_code(value: &str) -> Option<&'static Language> {
    LANGUAGES
        .iter()
        .find(|language| language.code == value || language.codes.contains(&value))
}

fn by_name(value: &str) -> Option<&'static Language> {
    LANGUAGES.iter().find(|language| {
        language.name.eq_ignore_ascii_case(value) || language.names.contains(&value)
    })
}

/// The picker choices, ordered by name.
pub fn playback_languages() -> &'static [Language] {
    LANGUAGES
}

/// Canonical code for a stored preference or a track's language tag. Accepts
/// two- and three-letter codes, locale tags, and language names. Well-formed
/// codes outside the picker list pass through so those tracks still group.
pub fn language_code(value: &str) -> Option<String> {
    let value = value.trim().to_lowercase().replace('_', "-");
    if let Some(language) = by_name(&value) {
        return Some(language.code.to_owned());
    }
    let base = value.split('-').next().unwrap_or_default();
    if let Some(language) = by_code(base) {
        return Some(language.code.to_owned());
    }
    let well_formed =
        matches!(base.len(), 2 | 3) && base.bytes().all(|byte| byte.is_ascii_lowercase());
    (well_formed && !UNDETERMINED.contains(&base)).then(|| base.to_owned())
}

/// Language named by a human-readable track label such as "English (SDH)" or
/// "Brazilian Portuguese". Words inside a label only match full language
/// names, since short codes collide with ordinary words ("no", "it", "per").
fn label_language_code(label: &str) -> Option<&'static str> {
    let label = label
        .split(['·', '(', '['])
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    by_name(&label)
        .or_else(|| by_code(&label))
        .or_else(|| {
            label
                .split(|character: char| !character.is_alphabetic())
                .find_map(by_name)
        })
        .map(|language| language.code)
}

/// Language of a track: its language tag when that is usable, otherwise
/// whatever its label names.
pub fn track_language_code(language: Option<&str>, label: Option<&str>) -> Option<String> {
    language
        .and_then(language_code)
        .or_else(|| label.and_then(label_language_code).map(str::to_owned))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picker_languages_are_unique_and_sorted_by_name() {
        let names: Vec<_> = LANGUAGES.iter().map(|language| language.name).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);

        let mut keys: Vec<_> = LANGUAGES
            .iter()
            .flat_map(|language| {
                [language.code]
                    .into_iter()
                    .chain(language.codes.iter().copied())
            })
            .collect();
        let total = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), total);
    }

    #[test]
    fn every_alias_resolves_to_its_language() {
        for language in LANGUAGES {
            for alias in language.codes.iter().chain(language.names) {
                assert_eq!(
                    track_language_code(Some(alias), None).as_deref(),
                    Some(language.code),
                    "{alias}"
                );
            }
            assert_eq!(
                track_language_code(None, Some(language.name)).as_deref(),
                Some(language.code)
            );
        }
    }

    #[test]
    fn normalizes_codes_locales_and_names() {
        for value in ["sv", "swe", "sv-SE", "sv_SE", "Swedish", " SVENSKA "] {
            assert_eq!(language_code(value).as_deref(), Some("sv"), "{value}");
        }
        assert_eq!(language_code("gle").as_deref(), Some("gle"));
        for value in ["", "und", "System default", "auto", "signs"] {
            assert_eq!(language_code(value), None, "{value}");
        }
    }

    #[test]
    fn labels_match_names_but_not_short_words() {
        let label = |value| track_language_code(None, Some(value));
        assert_eq!(label("Brazilian Portuguese (SDH)").as_deref(), Some("pt"));
        assert_eq!(label("POL").as_deref(), Some("pl"));
        assert_eq!(label("Polski · OpenSubtitles").as_deref(), Some("pl"));
        assert_eq!(label("No signs"), None);
        assert_eq!(label("Commentary per episode"), None);
    }

    #[test]
    fn the_language_tag_wins_over_the_label() {
        assert_eq!(
            track_language_code(Some("jpn"), Some("English")).as_deref(),
            Some("ja")
        );
        assert_eq!(
            track_language_code(Some("und"), Some("English")).as_deref(),
            Some("en")
        );
    }
}
