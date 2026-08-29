use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::HashSet;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamBehaviorHints {
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub binge_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub external_url: Option<String>,
    #[serde(default)]
    pub info_hash: Option<String>,
    #[serde(default)]
    pub file_idx: Option<Value>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub behavior_hints: Option<StreamBehaviorHints>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamCandidate {
    pub addon_id: String,
    #[serde(default)]
    pub addon_name: String,
    pub stream: Stream,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

pub fn playback_source(addon_id: String, stream: &Stream) -> PlaybackSource {
    PlaybackSource {
        addon_id,
        source_key: stream_source_key(stream),
        kind: if stream.info_hash.is_some() {
            "torrent"
        } else if stream.url.is_some() {
            "url"
        } else {
            "other"
        }
        .into(),
        info_hash: stream.info_hash.clone(),
        file_idx: stream.file_idx.as_ref().map(file_index),
        name: stream.name.clone(),
        title: stream.title.clone(),
        filename: stream
            .behavior_hints
            .as_ref()
            .and_then(|hints| hints.filename.clone()),
        binge_group: stream
            .behavior_hints
            .as_ref()
            .and_then(|hints| hints.binge_group.clone()),
    }
}

pub fn select_saved_stream(
    streams: &[StreamCandidate],
    source: Option<&PlaybackSource>,
) -> Option<usize> {
    let saved = source?;
    let candidates = playable_candidates(streams);
    let exact = candidates
        .iter()
        .copied()
        .filter(|&index| stream_source_key(&streams[index].stream) == saved.source_key)
        .collect::<Vec<_>>();
    let same_addon = exact
        .iter()
        .copied()
        .filter(|&index| streams[index].addon_id == saved.addon_id)
        .collect::<Vec<_>>();

    match same_addon.as_slice() {
        [index] => return Some(*index),
        [_, _, ..] => return None,
        [] => {}
    }
    if let [index] = exact.as_slice() {
        return Some(*index);
    }

    let binge_group = saved
        .binge_group
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let grouped = candidates
        .iter()
        .copied()
        .filter(|&index| {
            streams[index]
                .stream
                .behavior_hints
                .as_ref()
                .and_then(|hints| hints.binge_group.as_deref())
                == Some(binge_group)
        })
        .collect::<Vec<_>>();
    let same_addon_grouped = grouped
        .iter()
        .copied()
        .filter(|&index| streams[index].addon_id == saved.addon_id)
        .collect::<Vec<_>>();
    match same_addon_grouped.as_slice() {
        [index] => Some(*index),
        [_, _, ..] => None,
        [] => match grouped.as_slice() {
            [index] => Some(*index),
            _ => None,
        },
    }
}

pub fn select_single_stream(
    streams: &[StreamCandidate],
    excluded: Option<&Stream>,
) -> Option<usize> {
    let excluded_key = excluded.map(stream_source_key);
    let candidates = playable_candidates(streams)
        .into_iter()
        .filter(|&index| {
            excluded_key
                .as_ref()
                .is_none_or(|key| stream_source_key(&streams[index].stream) != *key)
        })
        .collect::<Vec<_>>();
    match candidates.as_slice() {
        [index] => Some(*index),
        _ => None,
    }
}

pub fn rank_streams(
    streams: &[StreamCandidate],
    previous: Option<&PlaybackSource>,
    saved: Option<&PlaybackSource>,
) -> Vec<usize> {
    let target_resolution = previous.and_then(playback_source_resolution);
    let previous_group = previous
        .and_then(|source| source.binge_group.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut candidates = playable_candidates(streams);
    candidates.sort_by(|&left, &right| {
        let left_stream = &streams[left];
        let right_stream = &streams[right];
        let left_key = stream_source_key(&left_stream.stream);
        let right_key = stream_source_key(&right_stream.stream);
        let left_rank = (
            saved.is_none_or(|source| source.source_key != left_key),
            previous_group
                .is_none_or(|group| stream_binge_group(&left_stream.stream) != Some(group)),
            previous.is_none_or(|source| source.addon_id != left_stream.addon_id),
            resolution_rank(stream_resolution(&left_stream.stream), target_resolution),
            left,
        );
        let right_rank = (
            saved.is_none_or(|source| source.source_key != right_key),
            previous_group
                .is_none_or(|group| stream_binge_group(&right_stream.stream) != Some(group)),
            previous.is_none_or(|source| source.addon_id != right_stream.addon_id),
            resolution_rank(stream_resolution(&right_stream.stream), target_resolution),
            right,
        );
        left_rank.cmp(&right_rank)
    });

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|&index| seen.insert(stream_source_key(&streams[index].stream)))
        .collect()
}

pub fn is_playable_stream_url(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    Url::parse(value)
        .map(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
        .unwrap_or(false)
}

pub fn stream_source_key(stream: &Stream) -> String {
    if let Some(info_hash) = &stream.info_hash {
        return format!(
            "torrent:{}:{}",
            info_hash.to_lowercase(),
            stream.file_idx.as_ref().map(file_index).unwrap_or_default()
        );
    }
    if let Some(url) = &stream.url {
        return format!("url:{}", normalize_stream_url(url));
    }
    format!(
        "other:{}",
        normalize_source_text([
            stream.name.as_deref(),
            stream.title.as_deref(),
            stream
                .behavior_hints
                .as_ref()
                .and_then(|hints| hints.filename.as_deref()),
        ])
    )
}

fn playable_candidates(streams: &[StreamCandidate]) -> Vec<usize> {
    streams
        .iter()
        .enumerate()
        .filter_map(|(index, candidate)| {
            is_playable_stream_url(candidate.stream.url.as_deref()).then_some(index)
        })
        .collect()
}

fn file_index(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        value => value.to_string(),
    }
}

fn normalize_stream_url(value: &str) -> String {
    let Ok(mut url) = Url::parse(value) else {
        return value
            .split(['?', '#'])
            .next()
            .unwrap_or(value)
            .trim_end_matches('/')
            .to_owned();
    };
    url.set_fragment(None);
    let mut query = url
        .query_pairs()
        .filter(|(key, _)| !is_sensitive_query_key(key))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    query.sort();
    url.set_query(None);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    let trimmed = url.path().trim_end_matches('/').to_owned();
    if trimmed.is_empty() {
        url.set_path("/");
    } else {
        url.set_path(&trimmed);
    }
    url.to_string()
}

fn is_sensitive_query_key(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    [
        "token",
        "sig",
        "signature",
        "expires",
        "expiry",
        "auth",
        "key",
    ]
    .iter()
    .any(|candidate| value.contains(candidate))
}

fn normalize_source_text<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> String {
    values
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("|")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn stream_binge_group(stream: &Stream) -> Option<&str> {
    stream
        .behavior_hints
        .as_ref()
        .and_then(|hints| hints.binge_group.as_deref())
}

fn playback_source_resolution(source: &PlaybackSource) -> Option<u32> {
    parse_resolution([
        source.name.as_deref(),
        source.title.as_deref(),
        source.filename.as_deref(),
        source.binge_group.as_deref(),
    ])
}

fn stream_resolution(stream: &Stream) -> Option<u32> {
    parse_resolution([
        stream.name.as_deref(),
        stream.title.as_deref(),
        stream.description.as_deref(),
        stream
            .behavior_hints
            .as_ref()
            .and_then(|hints| hints.filename.as_deref()),
        stream_binge_group(stream),
    ])
}

fn parse_resolution<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<u32> {
    let value = values
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if token_position(&value, "4k").is_some() || token_position(&value, "uhd").is_some() {
        return Some(2160);
    }
    [2160, 1440, 1080, 720, 576, 480, 360]
        .into_iter()
        .find(|resolution| numeric_token_position(&value, &resolution.to_string()).is_some())
}

fn token_position(value: &str, token: &str) -> Option<usize> {
    value.match_indices(token).find_map(|(index, _)| {
        let before = value[..index].chars().next_back();
        let after = value[index + token.len()..].chars().next();
        (!before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric))
            .then_some(index)
    })
}

fn numeric_token_position(value: &str, token: &str) -> Option<usize> {
    value.match_indices(token).find_map(|(index, _)| {
        let before = value[..index].chars().next_back();
        let after = value[index + token.len()..].chars().next();
        (!before.is_some_and(|value| value.is_ascii_digit())
            && !after.is_some_and(|value| value.is_ascii_digit()))
        .then_some(index)
    })
}

fn resolution_rank(candidate: Option<u32>, target: Option<u32>) -> (u8, u32) {
    match (candidate, target) {
        (_, None) => (0, 0),
        (None, Some(_)) => (3, u32::MAX),
        (Some(candidate), Some(target)) => match candidate.cmp(&target) {
            Ordering::Equal => (0, 0),
            Ordering::Less => (1, target - candidate),
            Ordering::Greater => (2, candidate - target),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(addon_id: &str, url: &str) -> StreamCandidate {
        StreamCandidate {
            addon_id: addon_id.into(),
            addon_name: addon_id.into(),
            stream: Stream {
                url: Some(url.into()),
                external_url: None,
                info_hash: None,
                file_idx: None,
                name: None,
                title: None,
                description: None,
                behavior_hints: None,
            },
        }
    }

    #[test]
    fn removes_transient_tokens_from_source_keys() {
        let stream = candidate(
            "one",
            "https://video.example/movie.m3u8?token=old&quality=1080p",
        );
        assert_eq!(
            stream_source_key(&stream.stream),
            "url:https://video.example/movie.m3u8?quality=1080p"
        );
    }

    #[test]
    fn matches_saved_streams_across_rotated_tokens() {
        let old = candidate("one", "https://video.example/movie.m3u8?token=old");
        let source = playback_source("one".into(), &old.stream);
        let streams = vec![candidate(
            "one",
            "https://video.example/movie.m3u8?token=fresh",
        )];
        assert_eq!(select_saved_stream(&streams, Some(&source)), Some(0));
    }

    #[test]
    fn ranks_saved_and_matching_binge_streams_first() {
        let mut binge = candidate("other", "https://example/binge");
        binge.stream.name = Some("1080p".into());
        binge.stream.behavior_hints = Some(StreamBehaviorHints {
            filename: None,
            binge_group: Some("show-release".into()),
        });
        let mut lower = candidate("current", "https://example/720");
        lower.stream.name = Some("720p".into());
        let mut higher = candidate("other", "https://example/4k");
        higher.stream.name = Some("4K".into());
        let saved_candidate = candidate("saved", "https://saved.example/video");
        let saved = playback_source("saved".into(), &saved_candidate.stream);
        let previous = PlaybackSource {
            addon_id: "current".into(),
            source_key: "url:https://current.example/video".into(),
            kind: "url".into(),
            info_hash: None,
            file_idx: None,
            name: Some("1080p".into()),
            title: None,
            filename: None,
            binge_group: Some("show-release".into()),
        };
        let streams = vec![higher, lower, binge, saved_candidate];
        assert_eq!(
            rank_streams(&streams, Some(&previous), Some(&saved)),
            vec![3, 2, 1, 0]
        );
    }
}
