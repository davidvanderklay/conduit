use conduit_core::{parse_manifest_json, ResourceRequest, StreamsResponse};
use serde::{Deserialize, Serialize};
use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};

const PROTOCOL_VERSION: u32 = 1;

#[derive(Default)]
pub struct ConduitEngine {
    generation: u64,
    closed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Action {
    ResolveFixture {
        protocol_version: u32,
        manifest_url: String,
        manifest_json: String,
        streams_json: String,
        media_type: String,
        id: String,
    },
    Cancel {
        protocol_version: u32,
    },
    Close {
        protocol_version: u32,
    },
}

impl Action {
    fn protocol_version(&self) -> u32 {
        match self {
            Self::ResolveFixture {
                protocol_version, ..
            }
            | Self::Cancel { protocol_version }
            | Self::Close { protocol_version } => *protocol_version,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum State {
    Resolved {
        protocol_version: u32,
        generation: u64,
        addon_name: String,
        request_url: String,
        stream_url: String,
        stream_title: String,
    },
    Cancelled {
        protocol_version: u32,
        generation: u64,
    },
    Closed {
        protocol_version: u32,
    },
    Error {
        protocol_version: u32,
        code: &'static str,
        message: String,
    },
}

impl ConduitEngine {
    fn dispatch(&mut self, json: &str) -> State {
        if self.closed {
            return error("engine_closed", "engine is already closed");
        }
        let action: Action = match serde_json::from_str(json) {
            Ok(action) => action,
            Err(value) => return error("invalid_action", value),
        };
        if action.protocol_version() != PROTOCOL_VERSION {
            return error(
                "unsupported_protocol",
                format!(
                    "expected protocol version {PROTOCOL_VERSION}, got {}",
                    action.protocol_version()
                ),
            );
        }

        match action {
            Action::ResolveFixture {
                manifest_url,
                manifest_json,
                streams_json,
                media_type,
                id,
                ..
            } => {
                self.generation += 1;
                let manifest = match parse_manifest_json(&manifest_json) {
                    Ok(value) => value,
                    Err(value) => return error("invalid_manifest", value),
                };
                if !manifest.supports("stream", &media_type, &id) {
                    return error(
                        "unsupported_resource",
                        "manifest does not support this stream",
                    );
                }
                let request_url = match (ResourceRequest {
                    resource: "stream".into(),
                    media_type,
                    id,
                    extras: vec![],
                })
                .url(&manifest_url)
                {
                    Ok(value) => value.to_string(),
                    Err(value) => return error("invalid_request", value),
                };
                let streams: StreamsResponse = match serde_json::from_str(&streams_json) {
                    Ok(value) => value,
                    Err(value) => return error("invalid_streams", value),
                };
                let selected = streams.streams.into_iter().find_map(|stream| match stream {
                    conduit_core::StreamSource::Url { url, name, title } => {
                        Some((url, title.or(name).unwrap_or_else(|| "Test stream".into())))
                    }
                    _ => None,
                });
                match selected {
                    Some((stream_url, stream_title)) => State::Resolved {
                        protocol_version: PROTOCOL_VERSION,
                        generation: self.generation,
                        addon_name: manifest.name,
                        request_url,
                        stream_url,
                        stream_title,
                    },
                    None => error("no_direct_stream", "fixture has no directly playable URL"),
                }
            }
            Action::Cancel { .. } => {
                self.generation += 1;
                State::Cancelled {
                    protocol_version: PROTOCOL_VERSION,
                    generation: self.generation,
                }
            }
            Action::Close { .. } => {
                self.closed = true;
                State::Closed {
                    protocol_version: PROTOCOL_VERSION,
                }
            }
        }
    }
}

fn error(code: &'static str, message: impl ToString) -> State {
    State::Error {
        protocol_version: PROTOCOL_VERSION,
        code,
        message: message.to_string(),
    }
}

fn response(engine: *mut ConduitEngine, action: *const c_char) -> *mut c_char {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if engine.is_null() || action.is_null() {
            return error("invalid_pointer", "engine and action must be non-null");
        }
        let action = unsafe { CStr::from_ptr(action) };
        let action = match action.to_str() {
            Ok(value) => value,
            Err(value) => return error("invalid_utf8", value),
        };
        unsafe { &mut *engine }.dispatch(action)
    }))
    .unwrap_or_else(|_| error("panic", "Rust engine panicked"));
    let json = serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"type":"error","protocolVersion":1,"code":"serialization","message":"response serialization failed"}"#.into()
    });
    CString::new(json)
        .expect("JSON cannot contain NUL")
        .into_raw()
}

#[no_mangle]
pub extern "C" fn conduit_mobile_abi_version() -> u32 {
    PROTOCOL_VERSION
}

#[no_mangle]
pub extern "C" fn conduit_engine_new() -> *mut ConduitEngine {
    Box::into_raw(Box::new(ConduitEngine::default()))
}

#[no_mangle]
pub extern "C" fn conduit_engine_dispatch(
    engine: *mut ConduitEngine,
    action_json: *const c_char,
) -> *mut c_char {
    response(engine, action_json)
}

#[no_mangle]
pub extern "C" fn conduit_string_free(value: *mut c_char) {
    if !value.is_null() {
        unsafe { drop(CString::from_raw(value)) };
    }
}

#[no_mangle]
pub extern "C" fn conduit_engine_free(engine: *mut ConduitEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::objects::{JClass, JString};
    use jni::sys::{jlong, jstring};
    use jni::JNIEnv;

    #[no_mangle]
    pub extern "system" fn Java_media_conduit_mobile_RustBridge_create(
        _env: JNIEnv,
        _class: JClass,
    ) -> jlong {
        conduit_engine_new() as jlong
    }

    #[no_mangle]
    pub extern "system" fn Java_media_conduit_mobile_RustBridge_dispatch(
        mut env: JNIEnv,
        _class: JClass,
        handle: jlong,
        action: JString,
    ) -> jstring {
        let action: String = match env.get_string(&action) {
            Ok(value) => value.into(),
            Err(value) => {
                return env
                    .new_string(serde_json::to_string(&error("invalid_utf8", value)).unwrap())
                    .expect("error string")
                    .into_raw()
            }
        };
        let action = CString::new(action).expect("Java string cannot contain NUL");
        let raw = response(handle as *mut ConduitEngine, action.as_ptr());
        let value = unsafe { CStr::from_ptr(raw) }.to_string_lossy();
        let output = env.new_string(value).expect("JSON response");
        conduit_string_free(raw);
        output.into_raw()
    }

    #[no_mangle]
    pub extern "system" fn Java_media_conduit_mobile_RustBridge_destroy(
        _env: JNIEnv,
        _class: JClass,
        handle: jlong,
    ) {
        conduit_engine_free(handle as *mut ConduitEngine);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
      "id":"media.conduit.fixture","version":"1.0.0","name":"Conduit Fixture",
      "resources":[{"name":"stream","types":["movie"],"idPrefixes":["conduit:"]}],
      "types":["movie"]
    }"#;
    const STREAMS: &str = r#"{"streams":[{"url":"https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4","title":"Big Buck Bunny"}]}"#;

    fn resolve(version: u32) -> String {
        serde_json::json!({
            "type": "resolveFixture", "protocolVersion": version,
            "manifestUrl": "https://fixture.conduit.invalid/manifest.json",
            "manifestJson": MANIFEST, "streamsJson": STREAMS,
            "mediaType": "movie", "id": "conduit:for-bigger-blazes"
        })
        .to_string()
    }

    #[test]
    fn resolves_fixture_through_existing_core_logic() {
        let mut engine = ConduitEngine::default();
        let value = serde_json::to_value(engine.dispatch(&resolve(1))).unwrap();
        assert_eq!(value["type"], "resolved");
        assert_eq!(
            value["requestUrl"],
            "https://fixture.conduit.invalid/stream/movie/conduit%3Afor-bigger-blazes.json"
        );
        assert_eq!(value["streamTitle"], "Big Buck Bunny");
    }

    #[test]
    fn rejects_unknown_protocol_versions() {
        let mut engine = ConduitEngine::default();
        let value = serde_json::to_value(engine.dispatch(&resolve(2))).unwrap();
        assert_eq!(value["code"], "unsupported_protocol");
    }

    #[test]
    fn close_is_terminal() {
        let mut engine = ConduitEngine::default();
        engine.dispatch(r#"{"type":"close","protocolVersion":1}"#);
        let value = serde_json::to_value(engine.dispatch(&resolve(1))).unwrap();
        assert_eq!(value["code"], "engine_closed");
    }

    #[test]
    fn c_abi_owns_and_releases_response_memory() {
        let engine = conduit_engine_new();
        let action = CString::new(resolve(1)).unwrap();
        let response = conduit_engine_dispatch(engine, action.as_ptr());
        assert!(!response.is_null());
        let value: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(response) }.to_str().unwrap()).unwrap();
        assert_eq!(value["type"], "resolved");
        conduit_string_free(response);
        conduit_engine_free(engine);
    }
}
