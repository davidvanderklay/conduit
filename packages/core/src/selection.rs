use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use url::Url;

/// Deterministic stream selection shared by every client (web, desktop,
/// mobile). All operations are pure: callers fetch add-on data and pass it
/// in; the core only computes decisions.
///
/// Behavior encoded here is pinned by golden fixtures under
/// `fixtures/stream-selection/`, which run against this crate (`cargo test`)
/// and against the WASM surface through Vitest.
const TRANSIENT_QUERY_KEYS: [&str; 7] = [
    "token",
    "sig",
    "signature",
    "expires",
    "expiry",
    "auth",
    "key",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamBehaviorHints {
    #[serde(default)]
    pub binge_group: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
}

/// Add-ons send `fileIdx` as a number or a numeric string.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum FileIdx {
    Number(i64),
    Text(String),
}

impl FileIdx {
    fn render(&self) -> String {
        match self {
            Self::Number(value) => value.to_string(),
            Self::Text(value) => value.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CandidateStream {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub external_url: Option<String>,
    #[serde(default)]
    pub info_hash: Option<String>,
    #[serde(default)]
    pub file_idx: Option<FileIdx>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub behavior_hints: Option<StreamBehaviorHints>,
}

impl CandidateStream {
    /// Blank binge groups carry no identity and are treated as absent.
    fn binge_group(&self) -> Option<&str> {
        self.behavior_hints
            .as_ref()
            .and_then(|hints| hints.binge_group.as_deref())
            .filter(|group| !group.is_empty())
    }

    fn filename(&self) -> Option<&str> {
        self.behavior_hints
            .as_ref()
            .and_then(|hints| hints.filename.as_deref())
    }

    fn resolution(&self) -> Option<u32> {
        parse_resolution([
            self.name.as_deref(),
            self.title.as_deref(),
            self.description.as_deref(),
            self.filename(),
            self.binge_group(),
        ])
    }
}

/// A stream together with the add-on that returned it.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamCandidate {
    pub addon_id: String,
    #[serde(default)]
    pub addon_name: String,
    #[serde(default)]
    pub stream: CandidateStream,
}

/// Persisted identity of a chosen source, compared across sessions where
/// provider URLs may rotate tokens.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSource {
    pub addon_id: String,
    pub source_key: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_idx: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binge_group: Option<String>,
}

/// Per-device playback constraints so TV clients shape selection without a
/// protocol break. Absent constraints leave ranking untouched.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConstraints {
    #[serde(default)]
    pub max_resolution_height: Option<u32>,
}

/// Builds the persisted identity for a candidate stream.
pub fn playback_source(addon_id: &str, stream: &CandidateStream) -> PlaybackSource {
    let kind = if stream.info_hash.is_some() {
        "torrent"
    } else if stream.url.is_some() {
        "url"
    } else {
        "other"
    };
    PlaybackSource {
        addon_id: addon_id.to_owned(),
        source_key: source_key(stream),
        kind: kind.to_owned(),
        info_hash: stream.info_hash.clone(),
        file_idx: stream.file_idx.as_ref().map(FileIdx::render),
        name: stream.name.clone(),
        title: stream.title.clone(),
        filename: stream.filename().map(str::to_owned),
        binge_group: stream.binge_group().map(str::to_owned),
    }
}

fn is_auto_selectable(candidate: &StreamCandidate) -> bool {
    candidate
        .stream
        .url
        .as_deref()
        .is_some_and(is_playable_stream_url)
}

/// Direct HTTP(S) URLs are auto-selectable; torrents, externals, and unsafe
/// schemes are not.
pub fn is_playable_stream_url(value: &str) -> bool {
    Url::parse(value)
        .ok()
        .filter(|url| url.has_host())
        .is_some_and(|url| matches!(url.scheme(), "http" | "https"))
}

/// Stable identity that ignores rotating query tokens.
pub fn source_key(stream: &CandidateStream) -> String {
    if let Some(info_hash) = &stream.info_hash {
        let file_idx = stream
            .file_idx
            .as_ref()
            .map(FileIdx::render)
            .unwrap_or_default();
        return format!("torrent:{}:{file_idx}", info_hash.to_lowercase());
    }
    if let Some(url) = &stream.url {
        return format!("url:{}", normalized_stream_url(url));
    }
    format!(
        "other:{}",
        normalize_source_text([
            stream.name.as_deref(),
            stream.title.as_deref(),
            stream.filename(),
        ])
    )
}

fn normalized_stream_url(value: &str) -> String {
    match Url::parse(value) {
        Ok(url) if url.has_host() => {
            let mut pairs: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(key, _)| !transient_query_key(key))
                .map(|(key, item)| (key.into_owned(), item.into_owned()))
                .collect();
            pairs.sort_by(|left, right| left.0.cmp(&right.0));
            let query = pairs
                .iter()
                .map(|(key, item)| format!("{key}={item}"))
                .collect::<Vec<_>>()
                .join("&");
            let trimmed_path = url.path().trim_end_matches('/');
            let path = if trimmed_path.is_empty() {
                "/"
            } else {
                trimmed_path
            };
            format!(
                "{}://{}{}{}",
                url.scheme(),
                authority(&url),
                path,
                if query.is_empty() {
                    String::new()
                } else {
                    format!("?{query}")
                }
            )
        }
        _ => value
            .split(['#', '?'])
            .next()
            .unwrap_or(value)
            .trim_end_matches('/')
            .to_owned(),
    }
}

fn authority(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_owned(),
    }
}

/// Keys containing any transient marker are dropped from stable identities,
/// mirroring the historical substring test shared by both clients.
fn transient_query_key(key: &str) -> bool {
    let lowered = key.to_lowercase();
    TRANSIENT_QUERY_KEYS
        .iter()
        .any(|part| lowered.contains(part))
}

fn normalize_source_text(values: [Option<&str>; 3]) -> String {
    let joined = values
        .iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("|");
    joined
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_resolution<const N: usize>(values: [Option<&str>; N]) -> Option<u32> {
    let joined = values
        .iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    if ultra_high_definition_pattern().is_match(&joined) {
        return Some(2160);
    }
    height_pattern()
        .captures(&joined)?
        .get(1)?
        .as_str()
        .parse()
        .ok()
}

fn ultra_high_definition_pattern() -> &'static regex::Regex {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:^|[^a-z0-9])(?:4k|uhd)(?:$|[^a-z0-9])").expect("valid pattern")
    })
}

fn height_pattern() -> &'static regex::Regex {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:^|[^0-9])(2160|1440|1080|720|576|480|360)p?(?:$|[^0-9])")
            .expect("valid pattern")
    })
}

/// Returns the saved source when exactly one candidate still carries its
/// stable identity, falling back to a unique binge group that prefers the
/// saved add-on.
pub fn select_saved(sources: &[StreamCandidate], saved: &PlaybackSource) -> Option<usize> {
    let candidates: Vec<usize> = sources
        .iter()
        .enumerate()
        .filter(|(_, candidate)| is_auto_selectable(candidate))
        .map(|(index, _)| index)
        .collect();

    let exact: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|index| source_key(&sources[*index].stream) == saved.source_key)
        .collect();
    let same_addon_exact: Vec<usize> = exact
        .iter()
        .copied()
        .filter(|index| sources[*index].addon_id == saved.addon_id)
        .collect();
    if same_addon_exact.len() == 1 {
        return Some(same_addon_exact[0]);
    }
    if same_addon_exact.len() > 1 {
        return None;
    }
    if exact.len() == 1 {
        return Some(exact[0]);
    }

    let group = saved.binge_group.as_deref()?;
    let group_matches: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|index| sources[*index].stream.binge_group() == Some(group))
        .collect();
    let same_addon_group: Vec<usize> = group_matches
        .iter()
        .copied()
        .filter(|index| sources[*index].addon_id == saved.addon_id)
        .collect();
    if same_addon_group.len() == 1 {
        return Some(same_addon_group[0]);
    }
    if same_addon_group.len() > 1 || group_matches.len() != 1 {
        return None;
    }
    Some(group_matches[0])
}

/// Auto-selects when exactly one playable candidate remains, optionally
/// ignoring a previously failed source by identity.
pub fn select_single_auto(
    sources: &[StreamCandidate],
    excluded: Option<&CandidateStream>,
) -> Option<usize> {
    let excluded_key = excluded.map(source_key);
    let remaining: Vec<usize> = sources
        .iter()
        .enumerate()
        .filter(|(_, candidate)| is_auto_selectable(candidate))
        .map(|(index, _)| index)
        .filter(|index| match &excluded_key {
            Some(key) => source_key(&sources[*index].stream) != *key,
            None => true,
        })
        .collect();
    if remaining.len() == 1 {
        Some(remaining[0])
    } else {
        None
    }
}

/// Orders playable candidates for an automatic transition: saved identity
/// first, then the previous binge group, then the previous add-on, then the
/// resolution closest to the previous source or the device cap, keeping
/// provider order on ties and dropping duplicate identities.
pub fn rank_auto(
    sources: &[StreamCandidate],
    previous: Option<&PlaybackSource>,
    saved: Option<&PlaybackSource>,
    device: Option<&DeviceConstraints>,
) -> Vec<usize> {
    let target = target_resolution(previous, device);
    let saved_key = saved.map(|source| source.source_key.clone());
    let binge_group = previous.and_then(|source| source.binge_group.as_deref());

    // Sort key ordering candidates by preference, then original position.
    type RankKey = (u8, u8, u8, i64, i64, usize);

    let mut ranked: Vec<(usize, RankKey)> = sources
        .iter()
        .enumerate()
        .filter(|(_, candidate)| is_auto_selectable(candidate))
        .map(|(index, candidate)| {
            let saved_match = saved_key
                .as_deref()
                .is_some_and(|key| source_key(&candidate.stream) == key);
            let binge_match =
                binge_group.is_some_and(|group| candidate.stream.binge_group() == Some(group));
            let addon_match = previous.is_some_and(|source| source.addon_id == candidate.addon_id);
            let saved_rank = u8::from(!saved_match);
            let binge_rank = u8::from(!binge_match);
            let addon_rank = u8::from(!addon_match);
            let (resolution_group, distance) =
                resolution_rank(candidate.stream.resolution(), target);
            (
                index,
                (
                    saved_rank,
                    binge_rank,
                    addon_rank,
                    resolution_group,
                    distance,
                    index,
                ),
            )
        })
        .collect();
    ranked.sort_by_key(|entry| entry.1);

    let mut seen = std::collections::HashSet::new();
    ranked
        .into_iter()
        .filter(|(index, _)| seen.insert(source_key(&sources[*index].stream)))
        .map(|(index, _)| index)
        .collect()
}

/// The ranking target prefers continuity with the previous source, clamped
/// by an explicit device cap; a cap alone acts as the target.
fn target_resolution(
    previous: Option<&PlaybackSource>,
    device: Option<&DeviceConstraints>,
) -> Option<u32> {
    let previous_target = previous.and_then(|source| {
        parse_resolution([
            source.name.as_deref(),
            source.title.as_deref(),
            source.filename.as_deref(),
            source.binge_group.as_deref(),
        ])
    });
    let cap = device.and_then(|device| device.max_resolution_height);
    match (previous_target, cap) {
        (Some(target), Some(cap)) => Some(target.min(cap)),
        (None, None) => None,
        (target, _) => target.or(cap),
    }
}

fn resolution_rank(candidate: Option<u32>, target: Option<u32>) -> (i64, i64) {
    match target {
        None => (0, 0),
        Some(target) => match candidate {
            None => (3, i64::MAX),
            Some(height) if height == target => (0, 0),
            Some(height) if height < target => (1, i64::from(target - height)),
            Some(height) => (2, i64::from(height - target)),
        },
    }
}
