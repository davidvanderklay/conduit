use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use time::{Date, OffsetDateTime};

const LEGACY_COMPLETION_MARKER_PREFIX: &str = "conduit:completion:";
const NEW_EPISODE_WINDOW_MS: i64 = 60 * 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub video_id: String,
    pub media_type: String,
    pub media_id: String,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default)]
    pub episode: Option<i32>,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub watched: bool,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub canonical_title_id: Option<String>,
    #[serde(default)]
    pub canonical_episode_key: Option<String>,
    #[serde(default)]
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    #[serde(default)]
    pub season: Option<i32>,
    #[serde(default)]
    pub episode: Option<i32>,
    #[serde(default)]
    pub released: Option<String>,
    #[serde(default)]
    pub available: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub name: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LibrarySort {
    LastWatched,
    Name,
    NameDesc,
    Watched,
    NotWatched,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EpisodeWatchState {
    NotStarted,
    InProgress,
    Watched,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PosterWatchState {
    Unwatched,
    Partial,
    Complete,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContinueWatchingDecision {
    pub kind: ContinueWatchingKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackInfo {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub language_name: String,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub channels: Option<String>,
    #[serde(default)]
    pub channel_count: Option<u32>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub bitrate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AudioTrackDisplay {
    pub primary: String,
    pub secondary: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ContinueWatchingKind {
    InProgress,
    NewEpisode,
    NextUp,
    Scheduled,
    CaughtUp,
}

pub fn episode_watch_state(progress: Option<&Progress>) -> EpisodeWatchState {
    match progress {
        Some(progress) if progress.watched => EpisodeWatchState::Watched,
        Some(progress) if progress.position_ms > 0 => EpisodeWatchState::InProgress,
        _ => EpisodeWatchState::NotStarted,
    }
}

pub fn episode_progress(progress: Option<&Progress>) -> f64 {
    match progress {
        Some(progress) if !progress.watched && progress.duration_ms > 0 => {
            (progress.position_ms as f64 / progress.duration_ms as f64).clamp(0.0, 1.0)
        }
        _ => 0.0,
    }
}

pub fn is_playback_complete(position_ms: i64, duration_ms: i64) -> bool {
    if position_ms < 0 || duration_ms <= 0 {
        return false;
    }
    position_ms as f64 / duration_ms as f64 >= 0.9
        || (duration_ms >= 600_000 && duration_ms - position_ms <= 120_000)
}

pub fn audio_track_display(info: &AudioTrackInfo, fallback: &str) -> AudioTrackDisplay {
    let codec = audio_codec_name(info.codec.as_deref());
    let title = info.title.trim();
    let language = info.language_name.trim();
    let base = if !title.is_empty() && !is_source_label(title) {
        title
    } else if !language.is_empty() {
        language
    } else {
        fallback
    };
    let channel_summary = audio_channel_summary(info.channel_count, info.channels.as_deref());
    let detailed_channels =
        info.channels.as_deref().map(str::trim).filter(|value| {
            !value.is_empty() && !value.chars().all(|value| value.is_ascii_digit())
        });
    let sample_rate = info
        .sample_rate
        .filter(|value| *value > 0)
        .map(format_sample_rate);
    let bitrate = info
        .bitrate
        .filter(|value| *value > 0)
        .map(|value| format!("{} kbps", (value + 500) / 1_000));
    let mut technical = Vec::new();
    for value in [
        detailed_channels.map(str::to_owned).or(channel_summary),
        sample_rate,
        bitrate,
        codec.filter(|codec| !base.to_lowercase().contains(&codec.to_lowercase())),
    ]
    .into_iter()
    .flatten()
    {
        if !technical.contains(&value) {
            technical.push(value);
        }
    }
    AudioTrackDisplay {
        primary: if technical.is_empty() {
            base.to_owned()
        } else {
            format!("{base} ({})", technical.join(", "))
        },
        secondary: if language.is_empty() {
            "Unknown language".into()
        } else {
            language.to_owned()
        },
    }
}

pub fn poster_watch_state(
    progress: &[Progress],
    media_type: &str,
    media_id: &str,
    episode_ids: &[String],
) -> PosterWatchState {
    let matching = progress
        .iter()
        .filter(|entry| {
            entry.media_type == media_type
                && entry.media_id == media_id
                && !entry.video_id.starts_with(LEGACY_COMPLETION_MARKER_PREFIX)
        })
        .collect::<Vec<_>>();
    if media_type == "movie" {
        return if matching
            .iter()
            .any(|entry| entry.video_id == media_id && entry.watched)
        {
            PosterWatchState::Complete
        } else {
            PosterWatchState::Unwatched
        };
    }
    let watched = matching
        .iter()
        .filter(|entry| entry.watched)
        .map(|entry| entry.video_id.as_str())
        .collect::<HashSet<_>>();
    if !episode_ids.is_empty() && episode_ids.iter().all(|id| watched.contains(id.as_str())) {
        return PosterWatchState::Complete;
    }
    if matching
        .iter()
        .any(|entry| entry.watched || entry.position_ms > 0)
    {
        PosterWatchState::Partial
    } else {
        PosterWatchState::Unwatched
    }
}

pub fn group_continue_watching(progress: &[Progress]) -> Vec<usize> {
    let mut grouped = HashMap::<String, usize>::new();
    for (index, entry) in progress.iter().enumerate() {
        let key = entry
            .canonical_title_id
            .clone()
            .unwrap_or_else(|| format!("{}\u{1f}{}", entry.media_type, entry.media_id));
        match grouped.get(&key).copied() {
            Some(current) if compare_progress(&progress[current], entry) != Ordering::Less => {}
            _ => {
                grouped.insert(key, index);
            }
        }
    }
    let mut indices = grouped.into_values().collect::<Vec<_>>();
    indices.sort_by(|&left, &right| compare_progress(&progress[right], &progress[left]));
    indices
}

pub fn continue_watching(
    progress: &Progress,
    videos: &[Video],
    today: &str,
    now_ms: i64,
    watched_video_ids: &HashSet<String>,
) -> ContinueWatchingDecision {
    let mut regular = videos
        .iter()
        .enumerate()
        .filter(|(_, video)| {
            video.season.unwrap_or(0) > 0
                && video.episode.is_some()
                && (video.available != Some(false) || is_upcoming(video, today, now_ms))
        })
        .collect::<Vec<_>>();
    regular.sort_by(|(_, left), (_, right)| compare_episodes(left, right));
    let anchor = regular
        .iter()
        .copied()
        .find(|(_, video)| video.id == progress.video_id)
        .or_else(|| {
            regular.iter().copied().find(|(_, video)| {
                video.season == progress.season && video.episode == progress.episode
            })
        });

    if progress.media_type != "series" || !progress.watched {
        return ContinueWatchingDecision {
            kind: ContinueWatchingKind::InProgress,
            video_index: anchor.map(|(index, _)| index),
        };
    }
    let Some((anchor_index, anchor_video)) = anchor else {
        return ContinueWatchingDecision {
            kind: ContinueWatchingKind::CaughtUp,
            video_index: None,
        };
    };
    let next = regular.into_iter().find(|(_, video)| {
        compare_episode_coordinates(video, anchor_video) == Ordering::Greater
            && !watched_video_ids.contains(&video.id)
    });
    if let Some((index, video)) = next {
        let kind = if has_aired(video, today, now_ms) {
            if is_release_alert(progress, video, now_ms) {
                ContinueWatchingKind::NewEpisode
            } else {
                ContinueWatchingKind::NextUp
            }
        } else if release_date_key(video.released.as_deref()).is_some() {
            ContinueWatchingKind::Scheduled
        } else {
            ContinueWatchingKind::CaughtUp
        };
        return ContinueWatchingDecision {
            kind,
            video_index: Some(index),
        };
    }
    ContinueWatchingDecision {
        kind: ContinueWatchingKind::CaughtUp,
        video_index: Some(anchor_index),
    }
}

pub fn eligible_watch_videos(videos: &[Video], season: Option<i32>, now_ms: i64) -> Vec<usize> {
    let today = OffsetDateTime::from_unix_timestamp_nanos(now_ms as i128 * 1_000_000)
        .ok()
        .map(|value| value.date().to_string())
        .unwrap_or_default();
    let mut indices = videos
        .iter()
        .enumerate()
        .filter(|(_, video)| season.is_none_or(|season| video.season.unwrap_or(1) == season))
        .filter(|(_, video)| has_aired(video, &today, now_ms))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    indices.sort_by(|&left, &right| compare_episodes_defaulted(&videos[left], &videos[right]));
    indices
}

pub fn order_library(
    items: &[LibraryItem],
    progress: &[Progress],
    sort: LibrarySort,
    episode_ids: &HashMap<String, Vec<String>>,
) -> Vec<usize> {
    let latest = latest_progress_by_media(progress);
    let mut indices = (0..items.len()).collect::<Vec<_>>();
    indices.sort_by(|&left, &right| {
        let left_item = &items[left];
        let right_item = &items[right];
        match sort {
            LibrarySort::Name => compare_name(left_item, right_item),
            LibrarySort::NameDesc => compare_name(right_item, left_item),
            LibrarySort::LastWatched => compare_last_watched(left_item, right_item, &latest),
            LibrarySort::Watched | LibrarySort::NotWatched => {
                let left_complete = item_complete(left_item, progress, episode_ids);
                let right_complete = item_complete(right_item, progress, episode_ids);
                let status = match sort {
                    LibrarySort::Watched => right_complete.cmp(&left_complete),
                    LibrarySort::NotWatched => left_complete.cmp(&right_complete),
                    _ => unreachable!(),
                };
                status.then_with(|| compare_last_watched(left_item, right_item, &latest))
            }
        }
    });
    indices
}

pub fn release_date_key(value: Option<&str>) -> Option<String> {
    let value = value?;
    let candidate = value.get(..10)?;
    if value.len() > 10 && value.as_bytes().get(10).copied() != Some(b'T') {
        return None;
    }
    Date::parse(
        candidate,
        &time::format_description::well_known::Iso8601::DATE,
    )
    .ok()
    .map(|date| date.to_string())
}

fn compare_progress(left: &Progress, right: &Progress) -> Ordering {
    progress_timestamp(left)
        .cmp(&progress_timestamp(right))
        .then_with(|| left.revision.cmp(&right.revision))
        .then_with(|| left.video_id.cmp(&right.video_id))
}

fn progress_timestamp(progress: &Progress) -> i64 {
    parse_instant(&progress.updated_at).unwrap_or(0)
}

fn compare_episodes(left: &Video, right: &Video) -> Ordering {
    compare_episode_coordinates(left, right).then_with(|| left.id.cmp(&right.id))
}

fn compare_episodes_defaulted(left: &Video, right: &Video) -> Ordering {
    left.season
        .unwrap_or(1)
        .cmp(&right.season.unwrap_or(1))
        .then_with(|| left.episode.unwrap_or(0).cmp(&right.episode.unwrap_or(0)))
        .then_with(|| left.id.cmp(&right.id))
}

fn compare_episode_coordinates(left: &Video, right: &Video) -> Ordering {
    left.season
        .cmp(&right.season)
        .then_with(|| left.episode.cmp(&right.episode))
}

fn has_aired(video: &Video, today: &str, now_ms: i64) -> bool {
    if video.available == Some(false) {
        return false;
    }
    if let Some(released) = video.released.as_deref() {
        if released.contains('T') {
            return parse_instant(released).is_none_or(|released| released <= now_ms);
        }
        if let Some(day) = release_date_key(Some(released)) {
            return day.as_str() <= today;
        }
    }
    true
}

fn is_upcoming(video: &Video, today: &str, now_ms: i64) -> bool {
    let Some(released) = video.released.as_deref() else {
        return false;
    };
    if released.contains('T') {
        return parse_instant(released).is_some_and(|released| released > now_ms);
    }
    release_date_key(Some(released))
        .is_some_and(|day| day.as_str() > today || (video.available == Some(false) && day == today))
}

fn is_release_alert(progress: &Progress, video: &Video, now_ms: i64) -> bool {
    let Some(release) = video.released.as_deref().and_then(parse_instant) else {
        return false;
    };
    let Some(watched) = parse_instant(&progress.updated_at) else {
        return false;
    };
    release > watched && release <= now_ms && now_ms - release < NEW_EPISODE_WINDOW_MS
}

fn parse_instant(value: &str) -> Option<i64> {
    if let Ok(value) = OffsetDateTime::parse(
        value,
        &time::format_description::well_known::Iso8601::DEFAULT,
    ) {
        return i64::try_from(value.unix_timestamp_nanos() / 1_000_000).ok();
    }
    let day = release_date_key(Some(value))?;
    let date = Date::parse(&day, &time::format_description::well_known::Iso8601::DATE).ok()?;
    i64::try_from(date.midnight().assume_utc().unix_timestamp_nanos() / 1_000_000).ok()
}

fn latest_progress_by_media(progress: &[Progress]) -> HashMap<String, &Progress> {
    let mut latest: HashMap<String, &Progress> = HashMap::new();
    for entry in progress {
        if entry.video_id.starts_with(LEGACY_COMPLETION_MARKER_PREFIX) {
            continue;
        }
        let key = media_key(&entry.media_type, &entry.media_id);
        match latest.get(&key) {
            Some(current) if progress_timestamp(current) >= progress_timestamp(entry) => {}
            _ => {
                latest.insert(key, entry);
            }
        }
    }
    latest
}

fn compare_last_watched(
    left: &LibraryItem,
    right: &LibraryItem,
    latest: &HashMap<String, &Progress>,
) -> Ordering {
    let left_progress = latest.get(&media_key(&left.media_type, &left.id));
    let right_progress = latest.get(&media_key(&right.media_type, &right.id));
    match (left_progress, right_progress) {
        (Some(left_progress), Some(right_progress)) => progress_timestamp(right_progress)
            .cmp(&progress_timestamp(left_progress))
            .then_with(|| item_date(right).cmp(&item_date(left)))
            .then_with(|| compare_name(left, right)),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => item_date(right)
            .cmp(&item_date(left))
            .then_with(|| compare_name(left, right)),
    }
}

fn item_date(item: &LibraryItem) -> i64 {
    item.created_at
        .as_deref()
        .and_then(parse_instant)
        .unwrap_or_else(|| parse_instant(&item.updated_at).unwrap_or(0))
}

fn compare_name(left: &LibraryItem, right: &LibraryItem) -> Ordering {
    left.name
        .to_lowercase()
        .cmp(&right.name.to_lowercase())
        .then_with(|| left.id.cmp(&right.id))
}

fn item_complete(
    item: &LibraryItem,
    progress: &[Progress],
    episode_ids: &HashMap<String, Vec<String>>,
) -> bool {
    poster_watch_state(
        progress,
        &item.media_type,
        &item.id,
        episode_ids
            .get(&media_key(&item.media_type, &item.id))
            .map(Vec::as_slice)
            .unwrap_or_default(),
    ) == PosterWatchState::Complete
}

fn media_key(media_type: &str, media_id: &str) -> String {
    format!("{media_type}:{media_id}")
}

fn is_source_label(value: &str) -> bool {
    let value = value.trim().to_lowercase();
    value.starts_with("http://") || value.starts_with("https://") || value.starts_with("www.")
}

fn audio_channel_summary(channel_count: Option<u32>, channels: Option<&str>) -> Option<String> {
    match channel_count {
        Some(1) => Some("Mono".into()),
        Some(2) => Some("Stereo".into()),
        Some(6) => Some("5.1".into()),
        Some(8) => Some("7.1".into()),
        Some(value) if value > 0 => Some(format!("{value} channels")),
        _ => channels
            .and_then(|value| value.split('(').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
    }
}

fn format_sample_rate(sample_rate: u32) -> String {
    if sample_rate.is_multiple_of(1_000) {
        format!("{} kHz", sample_rate / 1_000)
    } else {
        format!("{:.1} kHz", sample_rate as f64 / 1_000.0)
    }
}

fn audio_codec_name(codec: Option<&str>) -> Option<String> {
    let normalized = codec?
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_lowercase()
        .replace('_', "-");
    if normalized.is_empty() {
        return None;
    }
    Some(
        match normalized.as_str() {
            "ac3" | "ac-3" => "AC-3",
            "eac3" | "e-ac-3" | "ec-3" => "E-AC-3",
            "truehd" | "mlp-fba" => "TrueHD",
            "dts-hd" | "dts-hd-ma" => "DTS-HD",
            "dts" => "DTS",
            "aac" | "mp4a-latm" => "AAC",
            "opus" => "Opus",
            "vorbis" => "Vorbis",
            "flac" => "FLAC",
            _ => return Some(normalized.to_uppercase()),
        }
        .into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(video_id: &str, watched: bool, updated_at: &str) -> Progress {
        Progress {
            video_id: video_id.into(),
            media_type: "series".into(),
            media_id: "show".into(),
            season: Some(1),
            episode: video_id
                .strip_prefix("s1e")
                .and_then(|value| value.parse().ok()),
            position_ms: 0,
            duration_ms: 1_000,
            watched,
            updated_at: updated_at.into(),
            canonical_title_id: None,
            canonical_episode_key: None,
            revision: 0,
        }
    }

    #[test]
    fn validates_calendar_days() {
        assert_eq!(
            release_date_key(Some("2024-02-29T12:00:00Z")).as_deref(),
            Some("2024-02-29")
        );
        assert_eq!(release_date_key(Some("2023-02-29")), None);
    }

    #[test]
    fn promotes_the_next_released_episode() {
        let videos = vec![
            Video {
                id: "s1e2".into(),
                season: Some(1),
                episode: Some(2),
                released: None,
                available: None,
            },
            Video {
                id: "s1e3".into(),
                season: Some(1),
                episode: Some(3),
                released: Some("2026-08-11".into()),
                available: None,
            },
        ];
        let decision = continue_watching(
            &progress("s1e2", true, "2026-08-10T12:00:00Z"),
            &videos,
            "2026-08-12",
            1_786_536_000_000,
            &HashSet::new(),
        );
        assert_eq!(decision.kind, ContinueWatchingKind::NewEpisode);
        assert_eq!(decision.video_index, Some(1));
    }

    #[test]
    fn completes_long_videos_near_the_end() {
        assert!(is_playback_complete(500_000, 600_000));
        assert!(!is_playback_complete(400_000, 600_000));
        assert!(!is_playback_complete(-1, 600_000));
    }

    #[test]
    fn formats_audio_track_metadata() {
        let display = audio_track_display(
            &AudioTrackInfo {
                title: "Dolby Digital".into(),
                language_name: "Hungarian".into(),
                codec: Some("ac3".into()),
                channels: Some("5.1(side)".into()),
                channel_count: Some(6),
                sample_rate: Some(48_000),
                bitrate: Some(640_000),
            },
            "Audio 1",
        );
        assert_eq!(
            display.primary,
            "Dolby Digital (5.1(side), 48 kHz, 640 kbps, AC-3)"
        );
        assert_eq!(display.secondary, "Hungarian");
    }
}
