use conduit_core::{evaluate_json, parse_manifest_json, ResourceRequest, StreamsResponse};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

const PROTOCOL_VERSION: u32 = 2;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_PENDING_CANCELLATIONS: usize = 256;

#[derive(Default)]
pub struct ConduitEngine {
    generation: u64,
    closed: bool,
    cancelled: HashSet<String>,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Action {
    ResolveStreams {
        protocol_version: u32,
        request_id: String,
        manifest_url: String,
        manifest_json: String,
        streams_json: String,
        media_type: String,
        id: String,
    },
    Cancel {
        protocol_version: u32,
        request_id: String,
    },
    Close {
        protocol_version: u32,
    },
}

impl Action {
    fn protocol_version(&self) -> u32 {
        match self {
            Self::ResolveStreams {
                protocol_version, ..
            }
            | Self::Cancel {
                protocol_version, ..
            }
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
        request_id: String,
        generation: u64,
        addon_name: String,
        request_url: String,
        stream_url: String,
        stream_title: String,
    },
    Cancelled {
        protocol_version: u32,
        request_id: String,
        generation: u64,
    },
    Closed {
        protocol_version: u32,
    },
    Error {
        protocol_version: u32,
        request_id: Option<String>,
        code: &'static str,
        message: String,
        recoverable: bool,
    },
}

impl ConduitEngine {
    fn dispatch(&mut self, json: &str) -> State {
        if self.closed {
            return error(None, "engine_closed", "engine is already closed", false);
        }
        if json.len() > MAX_MESSAGE_BYTES {
            return error(
                None,
                "message_too_large",
                "action exceeds the 1 MiB limit",
                true,
            );
        }
        let action: Action = match serde_json::from_str(json) {
            Ok(action) => action,
            Err(value) => return error(None, "invalid_action", value, true),
        };
        if action.protocol_version() != PROTOCOL_VERSION {
            return error(
                None,
                "unsupported_protocol",
                format!(
                    "expected protocol version {PROTOCOL_VERSION}, got {}",
                    action.protocol_version()
                ),
                false,
            );
        }

        match action {
            Action::ResolveStreams {
                request_id,
                manifest_url,
                manifest_json,
                streams_json,
                media_type,
                id,
                ..
            } => {
                if let Err(message) = validate_request_id(&request_id) {
                    return error(None, "invalid_request_id", message, true);
                }
                self.generation += 1;
                if self.cancelled.remove(&request_id) {
                    return State::Cancelled {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        generation: self.generation,
                    };
                }
                let manifest = match parse_manifest_json(&manifest_json) {
                    Ok(value) => value,
                    Err(value) => return error(Some(request_id), "invalid_manifest", value, true),
                };
                if !manifest.supports("stream", &media_type, &id) {
                    return error(
                        Some(request_id),
                        "unsupported_resource",
                        "manifest does not support this stream",
                        true,
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
                    Err(value) => return error(Some(request_id), "invalid_request", value, true),
                };
                let streams: StreamsResponse = match serde_json::from_str(&streams_json) {
                    Ok(value) => value,
                    Err(value) => return error(Some(request_id), "invalid_streams", value, true),
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
                        request_id,
                        generation: self.generation,
                        addon_name: manifest.name,
                        request_url,
                        stream_url,
                        stream_title,
                    },
                    None => error(
                        Some(request_id),
                        "no_direct_stream",
                        "response has no directly playable URL",
                        true,
                    ),
                }
            }
            Action::Cancel { request_id, .. } => {
                if let Err(message) = validate_request_id(&request_id) {
                    return error(None, "invalid_request_id", message, true);
                }
                if self.cancelled.len() >= MAX_PENDING_CANCELLATIONS
                    && !self.cancelled.contains(&request_id)
                {
                    return error(
                        Some(request_id),
                        "too_many_cancellations",
                        "too many pending cancellation identifiers",
                        true,
                    );
                }
                self.generation += 1;
                self.cancelled.insert(request_id.clone());
                State::Cancelled {
                    protocol_version: PROTOCOL_VERSION,
                    request_id,
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

fn validate_request_id(request_id: &str) -> Result<(), &'static str> {
    if request_id.is_empty() {
        Err("requestId must not be empty")
    } else if request_id.len() > MAX_REQUEST_ID_BYTES {
        Err("requestId exceeds the 128-byte limit")
    } else {
        Ok(())
    }
}

fn error(
    request_id: Option<String>,
    code: &'static str,
    message: impl ToString,
    recoverable: bool,
) -> State {
    State::Error {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        code,
        message: message.to_string(),
        recoverable,
    }
}

pub struct ConduitEngineHandle(Mutex<ConduitEngine>);

fn response(engine: *mut ConduitEngineHandle, action: *const c_char) -> *mut c_char {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if engine.is_null() || action.is_null() {
            return error(
                None,
                "invalid_pointer",
                "engine and action must be non-null",
                false,
            );
        }
        let action = unsafe { CStr::from_ptr(action) };
        let action = match action.to_str() {
            Ok(value) => value,
            Err(value) => return error(None, "invalid_utf8", value, true),
        };
        match unsafe { &*engine }.0.lock() {
            Ok(mut engine) => engine.dispatch(action),
            Err(_) => error(
                None,
                "engine_poisoned",
                "engine state is unavailable",
                false,
            ),
        }
    }))
    .unwrap_or_else(|_| error(None, "panic", "Rust engine panicked", false));
    let json = serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"type":"error","protocolVersion":2,"requestId":null,"code":"serialization","message":"response serialization failed","recoverable":false}"#.into()
    });
    CString::new(json)
        .expect("JSON cannot contain NUL")
        .into_raw()
}

fn domain_response(action: *const c_char) -> *mut c_char {
    let json = catch_unwind(AssertUnwindSafe(|| {
        if action.is_null() {
            return r#"{"ok":false,"error":{"code":"invalid_pointer","message":"action must be non-null"}}"#.into();
        }
        let action = unsafe { CStr::from_ptr(action) };
        let action = match action.to_str() {
            Ok(value) => value,
            Err(error) => {
                return serde_json::json!({
                    "ok": false,
                    "error": { "code": "invalid_utf8", "message": error.to_string() }
                })
                .to_string();
            }
        };
        if action.len() > MAX_MESSAGE_BYTES {
            return r#"{"ok":false,"error":{"code":"message_too_large","message":"action exceeds the 1 MiB limit"}}"#.into();
        }
        evaluate_json(action)
    }))
    .unwrap_or_else(|_| {
        r#"{"ok":false,"error":{"code":"panic","message":"Rust core panicked"}}"#.into()
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
pub extern "C" fn conduit_engine_new() -> *mut ConduitEngineHandle {
    Box::into_raw(Box::new(ConduitEngineHandle(Mutex::new(
        ConduitEngine::default(),
    ))))
}

#[no_mangle]
pub extern "C" fn conduit_engine_dispatch(
    engine: *mut ConduitEngineHandle,
    action_json: *const c_char,
) -> *mut c_char {
    response(engine, action_json)
}

#[no_mangle]
pub extern "C" fn conduit_core_evaluate(action_json: *const c_char) -> *mut c_char {
    domain_response(action_json)
}

/// # Safety
/// `value` must be null or a pointer returned by `conduit_engine_dispatch` that
/// has not previously been freed.
#[no_mangle]
pub unsafe extern "C" fn conduit_string_free(value: *mut c_char) {
    if !value.is_null() {
        unsafe { drop(CString::from_raw(value)) };
    }
}

/// # Safety
/// `engine` must be null or a live pointer returned by `conduit_engine_new`.
/// No dispatch may be active when this function is called.
#[no_mangle]
pub unsafe extern "C" fn conduit_engine_free(engine: *mut ConduitEngineHandle) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

#[cfg(any(target_os = "android", feature = "host-jni"))]
mod android {
    use super::*;
    use jni::objects::{JClass, JString};
    use jni::sys::{jlong, jstring};
    use jni::EnvUnowned;

    #[no_mangle]
    pub extern "system" fn Java_media_conduit_mobile_RustBridge_create<'local>(
        _env: EnvUnowned<'local>,
        _class: JClass<'local>,
    ) -> jlong {
        conduit_engine_new() as jlong
    }

    #[no_mangle]
    pub extern "system" fn Java_media_conduit_mobile_RustBridge_dispatch<'local>(
        mut unowned_env: EnvUnowned<'local>,
        _class: JClass<'local>,
        handle: jlong,
        action: JString<'local>,
    ) -> jstring {
        unowned_env
            .with_env(|env| -> jni::errors::Result<jstring> {
                let action: String = match action.try_to_string(env) {
                    Ok(value) => value,
                    Err(value) => {
                        let value =
                            serde_json::to_string(&error(None, "invalid_utf8", value, true))
                                .expect("error response");
                        return Ok(env.new_string(value)?.into_raw());
                    }
                };
                let action = CString::new(action).expect("Java string cannot contain NUL");
                let raw = response(handle as *mut ConduitEngineHandle, action.as_ptr());
                let value = unsafe { CStr::from_ptr(raw) }
                    .to_string_lossy()
                    .into_owned();
                unsafe { conduit_string_free(raw) };
                Ok(env.new_string(value)?.into_raw())
            })
            .resolve::<jni::errors::ThrowRuntimeExAndDefault>()
    }

    #[no_mangle]
    pub extern "system" fn Java_media_conduit_mobile_RustBridge_evaluate<'local>(
        mut unowned_env: EnvUnowned<'local>,
        _class: JClass<'local>,
        action: JString<'local>,
    ) -> jstring {
        unowned_env
            .with_env(|env| -> jni::errors::Result<jstring> {
                let action = action.try_to_string(env)?;
                let action = CString::new(action).expect("Java string cannot contain NUL");
                let raw = domain_response(action.as_ptr());
                let value = unsafe { CStr::from_ptr(raw) }
                    .to_string_lossy()
                    .into_owned();
                unsafe { conduit_string_free(raw) };
                Ok(env.new_string(value)?.into_raw())
            })
            .resolve::<jni::errors::ThrowRuntimeExAndDefault>()
    }

    #[no_mangle]
    pub extern "system" fn Java_media_conduit_mobile_RustBridge_destroy<'local>(
        _env: EnvUnowned<'local>,
        _class: JClass<'local>,
        handle: jlong,
    ) {
        unsafe { conduit_engine_free(handle as *mut ConduitEngineHandle) };
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
            "type": "resolveStreams", "protocolVersion": version, "requestId": "resolve-1",
            "manifestUrl": "https://fixture.conduit.invalid/manifest.json",
            "manifestJson": MANIFEST, "streamsJson": STREAMS,
            "mediaType": "movie", "id": "conduit:for-bigger-blazes"
        })
        .to_string()
    }

    #[test]
    fn resolves_fixture_through_existing_core_logic() {
        let mut engine = ConduitEngine::default();
        let value = serde_json::to_value(engine.dispatch(&resolve(2))).unwrap();
        assert_eq!(value["type"], "resolved");
        assert_eq!(
            value["requestUrl"],
            "https://fixture.conduit.invalid/stream/movie/conduit%3Afor-bigger-blazes.json"
        );
        assert_eq!(value["streamTitle"], "Big Buck Bunny");
        assert_eq!(value["requestId"], "resolve-1");
    }

    #[test]
    fn rejects_unknown_protocol_versions() {
        let mut engine = ConduitEngine::default();
        let value = serde_json::to_value(engine.dispatch(&resolve(1))).unwrap();
        assert_eq!(value["code"], "unsupported_protocol");
    }

    #[test]
    fn close_is_terminal() {
        let mut engine = ConduitEngine::default();
        engine.dispatch(r#"{"type":"close","protocolVersion":2}"#);
        let value = serde_json::to_value(engine.dispatch(&resolve(2))).unwrap();
        assert_eq!(value["code"], "engine_closed");
    }

    #[test]
    fn c_abi_owns_and_releases_response_memory() {
        let engine = conduit_engine_new();
        let action = CString::new(resolve(2)).unwrap();
        let response = conduit_engine_dispatch(engine, action.as_ptr());
        assert!(!response.is_null());
        let value: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(response) }.to_str().unwrap()).unwrap();
        assert_eq!(value["type"], "resolved");
        unsafe {
            conduit_string_free(response);
            conduit_engine_free(engine);
        }
    }

    #[test]
    fn stateless_domain_calls_use_the_shared_core() {
        let action = CString::new(
            r#"{
                "type":"supportsResource",
                "manifest":{
                    "id":"org.example","version":"1","name":"Example",
                    "resources":["catalog"],"types":[],"catalogs":[]
                },
                "resource":"catalog","mediaType":"series","id":"anything"
            }"#,
        )
        .unwrap();
        let response = conduit_core_evaluate(action.as_ptr());
        let value: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(response) }.to_str().unwrap()).unwrap();
        assert_eq!(value["value"], true);
        unsafe { conduit_string_free(response) };
    }

    #[test]
    fn c_abi_matches_shared_domain_fixtures() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../core/tests/fixtures/domain.json")).unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let action = CString::new(fixture["action"].to_string()).unwrap();
            let response = conduit_core_evaluate(action.as_ptr());
            let value: serde_json::Value =
                serde_json::from_str(unsafe { CStr::from_ptr(response) }.to_str().unwrap())
                    .unwrap();
            assert_eq!(value["value"], fixture["expected"], "{}", fixture["name"]);
            unsafe { conduit_string_free(response) };
        }
    }

    #[test]
    fn cancellation_is_scoped_to_a_request_id() {
        let mut engine = ConduitEngine::default();
        let cancelled =
            engine.dispatch(r#"{"type":"cancel","protocolVersion":2,"requestId":"resolve-1"}"#);
        let value = serde_json::to_value(cancelled).unwrap();
        assert_eq!(value["requestId"], "resolve-1");

        let value = serde_json::to_value(engine.dispatch(&resolve(2))).unwrap();
        assert_eq!(value["type"], "cancelled");
        assert_eq!(value["requestId"], "resolve-1");
    }

    #[test]
    fn rejects_oversized_messages_before_parsing() {
        let mut engine = ConduitEngine::default();
        let value =
            serde_json::to_value(engine.dispatch(&"x".repeat(MAX_MESSAGE_BYTES + 1))).unwrap();
        assert_eq!(value["code"], "message_too_large");
        assert_eq!(value["recoverable"], true);
    }

    #[test]
    fn bounds_request_identifiers_and_pending_cancellations() {
        let mut engine = ConduitEngine::default();
        let oversized = serde_json::json!({
            "type": "cancel", "protocolVersion": 2,
            "requestId": "x".repeat(MAX_REQUEST_ID_BYTES + 1),
        });
        let value = serde_json::to_value(engine.dispatch(&oversized.to_string())).unwrap();
        assert_eq!(value["code"], "invalid_request_id");

        for index in 0..MAX_PENDING_CANCELLATIONS {
            let action = serde_json::json!({
                "type": "cancel", "protocolVersion": 2, "requestId": format!("cancel-{index}"),
            });
            engine.dispatch(&action.to_string());
        }
        let value = serde_json::to_value(
            engine.dispatch(r#"{"type":"cancel","protocolVersion":2,"requestId":"one-too-many"}"#),
        )
        .unwrap();
        assert_eq!(value["code"], "too_many_cancellations");
    }
}
