mod addon;
mod domain;
mod error;
pub mod media;
pub mod playback;
mod resource;

pub use addon::{
    AddonDescriptor, AddonManifest, AddonResource, CatalogDescriptor, ManifestResource,
};
pub use domain::evaluate_json;
pub use error::CoreError;
pub use playback::{PlaybackSource, Stream, StreamBehaviorHints, StreamCandidate};
pub use resource::{ExtraArg, ResourceRequest};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub name: String,
    #[serde(default)]
    pub poster: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogResponse {
    #[serde(default)]
    pub metas: Vec<CatalogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum StreamSource {
    Url {
        url: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        title: Option<String>,
    },
    Torrent {
        #[serde(rename = "infoHash")]
        info_hash: String,
        #[serde(rename = "fileIdx", default)]
        file_idx: Option<u32>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        title: Option<String>,
    },
    External {
        #[serde(rename = "externalUrl")]
        external_url: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        title: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StreamsResponse {
    #[serde(default)]
    pub streams: Vec<StreamSource>,
}

pub fn parse_manifest_json(json: &str) -> Result<AddonManifest, CoreError> {
    let manifest: AddonManifest = serde_json::from_str(json)?;
    manifest.validate()?;
    Ok(manifest)
}

pub fn parse_catalog_json(json: &str) -> Result<CatalogResponse, CoreError> {
    Ok(serde_json::from_str(json)?)
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use gloo_net::http::Request;
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use wasm_bindgen::prelude::*;

    fn js_error(error: impl std::fmt::Display) -> JsValue {
        js_sys::Error::new(&error.to_string()).into()
    }

    fn to_js_value(value: &impl Serialize) -> Result<JsValue, JsValue> {
        value
            .serialize(&Serializer::json_compatible())
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = parseManifest)]
    pub fn parse_manifest(value: &str) -> Result<JsValue, JsValue> {
        let manifest = parse_manifest_json(value).map_err(js_error)?;
        to_js_value(&manifest)
    }

    #[wasm_bindgen(js_name = evaluateCore)]
    pub fn evaluate_core(action: &str) -> String {
        evaluate_json(action)
    }

    #[wasm_bindgen(js_name = buildResourceUrl)]
    pub fn build_resource_url(
        manifest_url: &str,
        resource: &str,
        media_type: &str,
        id: &str,
        extras: JsValue,
    ) -> Result<String, JsValue> {
        let extras: Vec<ExtraArg> = serde_wasm_bindgen::from_value(extras).map_err(js_error)?;
        ResourceRequest {
            resource: resource.to_owned(),
            media_type: media_type.to_owned(),
            id: id.to_owned(),
            extras,
        }
        .url(manifest_url)
        .map(|url| url.to_string())
        .map_err(js_error)
    }

    #[wasm_bindgen(js_name = fetchManifest)]
    pub async fn fetch_manifest(manifest_url: &str) -> Result<JsValue, JsValue> {
        let response = Request::get(manifest_url).send().await.map_err(js_error)?;
        if !response.ok() {
            return Err(js_error(format!(
                "add-on returned HTTP {}",
                response.status()
            )));
        }
        let body = response.text().await.map_err(js_error)?;
        let manifest = parse_manifest_json(&body).map_err(js_error)?;
        to_js_value(&manifest)
    }

    #[wasm_bindgen(js_name = fetchResource)]
    pub async fn fetch_resource(
        manifest_url: &str,
        resource: &str,
        media_type: &str,
        id: &str,
        extras: JsValue,
    ) -> Result<JsValue, JsValue> {
        let url = build_resource_url(manifest_url, resource, media_type, id, extras)?;
        let response = Request::get(&url).send().await.map_err(js_error)?;
        if !response.ok() {
            return Err(js_error(format!(
                "add-on returned HTTP {}",
                response.status()
            )));
        }
        let value: serde_json::Value = response.json().await.map_err(js_error)?;
        to_js_value(&value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_manifest() {
        let manifest = parse_manifest_json(
            r#"{
                "id": "org.example",
                "version": "1.0.0",
                "name": "Example",
                "resources": ["catalog", "stream"],
                "types": ["movie"],
                "catalogs": [{"id": "popular", "type": "movie"}]
            }"#,
        )
        .unwrap();

        assert_eq!(manifest.id, "org.example");
        assert_eq!(manifest.catalogs.len(), 1);
    }

    #[test]
    fn rejects_manifest_without_identity() {
        let error = parse_manifest_json(
            r#"{
                "id": "",
                "version": "1.0.0",
                "name": "Example",
                "resources": [],
                "types": []
            }"#,
        )
        .unwrap_err();

        assert_eq!(error.to_string(), "manifest id cannot be empty");
    }

    #[test]
    fn parses_direct_and_torrent_streams() {
        let response: StreamsResponse = serde_json::from_str(
            r#"{"streams":[
                {"url":"https://example.com/movie.mp4","name":"Direct"},
                {"infoHash":"abcdef","fileIdx":2,"title":"Torrent"}
            ]}"#,
        )
        .unwrap();

        assert_eq!(response.streams.len(), 2);
        assert!(matches!(
            &response.streams[1],
            StreamSource::Torrent {
                file_idx: Some(2),
                ..
            }
        ));
    }
}
