use crate::CoreError;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExtraArg {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceRequest {
    pub resource: String,
    pub media_type: String,
    pub id: String,
    pub extras: Vec<ExtraArg>,
}

impl ResourceRequest {
    pub fn url(&self, manifest_url: &str) -> Result<Url, CoreError> {
        let mut url = Url::parse(manifest_url)?;
        let path = url.path().trim_end_matches('/');
        if !path.ends_with("manifest.json") {
            return Err(CoreError::InvalidManifestPath);
        }

        let base = path.trim_end_matches("manifest.json").trim_end_matches('/');
        let resource = encode_segment(&self.resource);
        let media_type = encode_segment(&self.media_type);
        let id = encode_segment(&self.id);

        let resource_path = if self.extras.is_empty() {
            format!("{base}/{resource}/{media_type}/{id}.json")
        } else {
            let extras = self
                .extras
                .iter()
                .map(|extra| {
                    format!(
                        "{}={}",
                        encode_segment(&extra.name),
                        encode_segment(&extra.value)
                    )
                })
                .collect::<Vec<_>>()
                .join("&");
            format!("{base}/{resource}/{media_type}/{id}/{extras}.json")
        };

        url.set_path(&resource_path);
        url.set_query(None);
        url.set_fragment(None);
        Ok(url)
    }
}

fn encode_segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_basic_resource_url() {
        let request = ResourceRequest {
            resource: "catalog".into(),
            media_type: "movie".into(),
            id: "popular".into(),
            extras: vec![],
        };

        assert_eq!(
            request
                .url("https://example.com/configured/manifest.json")
                .unwrap()
                .as_str(),
            "https://example.com/configured/catalog/movie/popular.json"
        );
    }

    #[test]
    fn preserves_stremio_extra_argument_shape() {
        let request = ResourceRequest {
            resource: "catalog".into(),
            media_type: "movie".into(),
            id: "popular".into(),
            extras: vec![
                ExtraArg {
                    name: "search".into(),
                    value: "The Matrix".into(),
                },
                ExtraArg {
                    name: "skip".into(),
                    value: "20".into(),
                },
            ],
        };

        assert_eq!(
            request
                .url("https://example.com/manifest.json")
                .unwrap()
                .as_str(),
            "https://example.com/catalog/movie/popular/search=The%20Matrix&skip=20.json"
        );
    }
}
