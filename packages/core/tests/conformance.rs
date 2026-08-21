use conduit_core::selection::{
    self, CandidateStream, DeviceConstraints, PlaybackSource, StreamCandidate,
};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Fixture {
    name: String,
    operation: String,
    request: Value,
    expected: Value,
}

#[test]
fn golden_fixtures_hold_for_every_operation() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/stream-selection");
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("fixture directory exists")
        .map(|entry| entry.expect("readable fixture entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();

    assert!(!paths.is_empty(), "no fixtures found in {dir:?}");

    for path in paths {
        let raw = fs::read_to_string(&path).expect("fixture readable");
        let fixture: Fixture = serde_json::from_str(&raw).expect("valid fixture");
        let observed = run(&fixture.operation, &fixture.request)
            .unwrap_or_else(|error| panic!("fixture {} failed: {error}", fixture.name));
        assert_eq!(
            observed, fixture.expected,
            "fixture {} ({}) diverged",
            fixture.name, fixture.operation
        );
    }
}

fn run(operation: &str, request: &Value) -> Result<Value, String> {
    match operation {
        "playbackSource" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Request {
                addon_id: String,
                stream: CandidateStream,
            }
            let request: Request =
                serde_json::from_value(request.clone()).map_err(|e| e.to_string())?;
            let source = selection::playback_source(&request.addon_id, &request.stream);
            serde_json::to_value(SourceResponse {
                playback_source: source,
            })
            .map_err(|e| e.to_string())
        }
        "selectSavedStream" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Request {
                sources: Vec<StreamCandidate>,
                saved: Option<PlaybackSource>,
            }
            let request: Request =
                serde_json::from_value(request.clone()).map_err(|e| e.to_string())?;
            let index = request
                .saved
                .as_ref()
                .and_then(|saved| selection::select_saved(&request.sources, saved));
            serde_json::to_value(IndexResponse { index }).map_err(|e| e.to_string())
        }
        "selectSingleAutoStream" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Request {
                sources: Vec<StreamCandidate>,
                excluded: Option<CandidateStream>,
            }
            let request: Request =
                serde_json::from_value(request.clone()).map_err(|e| e.to_string())?;
            let index = selection::select_single_auto(&request.sources, request.excluded.as_ref());
            serde_json::to_value(IndexResponse { index }).map_err(|e| e.to_string())
        }
        "rankAutoStreams" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Request {
                sources: Vec<StreamCandidate>,
                previous: Option<PlaybackSource>,
                saved: Option<PlaybackSource>,
                device: Option<DeviceConstraints>,
            }
            let request: Request =
                serde_json::from_value(request.clone()).map_err(|e| e.to_string())?;
            let order = selection::rank_auto(
                &request.sources,
                request.previous.as_ref(),
                request.saved.as_ref(),
                request.device.as_ref(),
            );
            serde_json::to_value(OrderResponse { order }).map_err(|e| e.to_string())
        }
        other => Err(format!("unknown operation {other}")),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceResponse {
    playback_source: PlaybackSource,
}

#[derive(serde::Serialize)]
struct IndexResponse {
    index: Option<usize>,
}

#[derive(serde::Serialize)]
struct OrderResponse {
    order: Vec<usize>,
}
