use crate::media::{
    audio_track_display, continue_watching, eligible_watch_videos, episode_progress,
    episode_watch_state, group_continue_watching, is_playback_complete, order_library,
    poster_watch_state, release_date_key, AudioTrackInfo, LibraryItem, LibrarySort, Progress,
    Video,
};
use crate::playback::{
    is_playable_stream_url, playback_source, rank_streams, select_saved_stream,
    select_single_stream, PlaybackSource, Stream, StreamCandidate,
};
use crate::{AddonManifest, ExtraArg, ResourceRequest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum DomainAction {
    SupportsResource {
        manifest: AddonManifest,
        resource: String,
        media_type: String,
        id: String,
    },
    BuildResourceUrl {
        manifest_url: String,
        resource: String,
        media_type: String,
        id: String,
        #[serde(default)]
        extras: Vec<ExtraArg>,
    },
    PlaybackSource {
        addon_id: String,
        stream: Stream,
    },
    IsPlayableStreamUrl {
        value: Option<String>,
    },
    SelectSavedStream {
        streams: Vec<StreamCandidate>,
        source: Option<PlaybackSource>,
    },
    SelectSingleStream {
        streams: Vec<StreamCandidate>,
        excluded: Option<Stream>,
    },
    RankStreams {
        streams: Vec<StreamCandidate>,
        previous: Option<PlaybackSource>,
        saved: Option<PlaybackSource>,
    },
    EpisodeWatchState {
        progress: Option<Progress>,
    },
    EpisodeProgress {
        progress: Option<Progress>,
    },
    PosterWatchState {
        progress: Vec<Progress>,
        media_type: String,
        media_id: String,
        #[serde(default)]
        episode_ids: Vec<String>,
    },
    GroupContinueWatching {
        progress: Vec<Progress>,
    },
    ContinueWatching {
        progress: Progress,
        videos: Vec<Video>,
        today: String,
        now_ms: i64,
        #[serde(default)]
        watched_video_ids: HashSet<String>,
    },
    EligibleWatchVideos {
        videos: Vec<Video>,
        season: Option<i32>,
        now_ms: i64,
    },
    OrderLibrary {
        items: Vec<LibraryItem>,
        progress: Vec<Progress>,
        sort: LibrarySort,
        #[serde(default)]
        episode_ids: HashMap<String, Vec<String>>,
    },
    ReleaseDateKey {
        value: Option<String>,
    },
    IsPlaybackComplete {
        position_ms: i64,
        duration_ms: i64,
    },
    AudioTrackDisplay {
        info: AudioTrackInfo,
        fallback: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DomainResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<DomainError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DomainError {
    code: &'static str,
    message: String,
}

pub fn evaluate_json(json: &str) -> String {
    let action = match serde_json::from_str::<DomainAction>(json) {
        Ok(action) => action,
        Err(error) => return error_response("invalid_action", error),
    };
    let result = match action {
        DomainAction::SupportsResource {
            manifest,
            resource,
            media_type,
            id,
        } => value_response(manifest.supports(&resource, &media_type, &id)),
        DomainAction::BuildResourceUrl {
            manifest_url,
            resource,
            media_type,
            id,
            extras,
        } => ResourceRequest {
            resource,
            media_type,
            id,
            extras,
        }
        .url(&manifest_url)
        .map(|url| value_response(url.to_string()))
        .unwrap_or_else(|error| error_response("invalid_resource_request", error)),
        DomainAction::PlaybackSource { addon_id, stream } => {
            value_response(playback_source(addon_id, &stream))
        }
        DomainAction::IsPlayableStreamUrl { value } => {
            value_response(is_playable_stream_url(value.as_deref()))
        }
        DomainAction::SelectSavedStream { streams, source } => {
            value_response(select_saved_stream(&streams, source.as_ref()))
        }
        DomainAction::SelectSingleStream { streams, excluded } => {
            value_response(select_single_stream(&streams, excluded.as_ref()))
        }
        DomainAction::RankStreams {
            streams,
            previous,
            saved,
        } => value_response(rank_streams(&streams, previous.as_ref(), saved.as_ref())),
        DomainAction::EpisodeWatchState { progress } => {
            value_response(episode_watch_state(progress.as_ref()))
        }
        DomainAction::EpisodeProgress { progress } => {
            value_response(episode_progress(progress.as_ref()))
        }
        DomainAction::PosterWatchState {
            progress,
            media_type,
            media_id,
            episode_ids,
        } => value_response(poster_watch_state(
            &progress,
            &media_type,
            &media_id,
            &episode_ids,
        )),
        DomainAction::GroupContinueWatching { progress } => {
            value_response(group_continue_watching(&progress))
        }
        DomainAction::ContinueWatching {
            progress,
            videos,
            today,
            now_ms,
            watched_video_ids,
        } => value_response(continue_watching(
            &progress,
            &videos,
            &today,
            now_ms,
            &watched_video_ids,
        )),
        DomainAction::EligibleWatchVideos {
            videos,
            season,
            now_ms,
        } => value_response(eligible_watch_videos(&videos, season, now_ms)),
        DomainAction::OrderLibrary {
            items,
            progress,
            sort,
            episode_ids,
        } => value_response(order_library(&items, &progress, sort, &episode_ids)),
        DomainAction::ReleaseDateKey { value } => {
            value_response(release_date_key(value.as_deref()))
        }
        DomainAction::IsPlaybackComplete {
            position_ms,
            duration_ms,
        } => value_response(is_playback_complete(position_ms, duration_ms)),
        DomainAction::AudioTrackDisplay { info, fallback } => {
            value_response(audio_track_display(&info, &fallback))
        }
    };
    result
}

fn value_response(value: impl Serialize) -> String {
    match serde_json::to_value(value) {
        Ok(value) => serde_json::to_string(&DomainResponse {
            ok: true,
            value: Some(value),
            error: None,
        })
        .expect("domain response is serializable"),
        Err(error) => error_response("serialization", error),
    }
}

fn error_response(code: &'static str, error: impl std::fmt::Display) -> String {
    serde_json::to_string(&DomainResponse {
        ok: false,
        value: None,
        error: Some(DomainError {
            code,
            message: error.to_string(),
        }),
    })
    .expect("domain error is serializable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_capability_checks() {
        let response: Value = serde_json::from_str(&evaluate_json(
            r#"{
                "type":"supportsResource",
                "manifest":{
                    "id":"org.example","version":"1","name":"Example",
                    "resources":[{"name":"stream","types":["movie"],"idPrefixes":["tt"]}],
                    "types":["movie"],"catalogs":[]
                },
                "resource":"stream","mediaType":"movie","id":"tt123"
            }"#,
        ))
        .unwrap();
        assert_eq!(response["value"], true);
    }

    #[test]
    fn returns_stable_invalid_action_errors() {
        let response: Value = serde_json::from_str(&evaluate_json("{}")).unwrap();
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "invalid_action");
    }
}
