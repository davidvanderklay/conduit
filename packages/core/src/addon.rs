use crate::CoreError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonManifest {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub background: Option<String>,
    #[serde(default)]
    pub resources: Vec<ManifestResource>,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub catalogs: Vec<CatalogDescriptor>,
    #[serde(default)]
    pub id_prefixes: Vec<String>,
}

impl AddonManifest {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.id.trim().is_empty() {
            return Err(CoreError::EmptyManifestId);
        }
        if self.name.trim().is_empty() {
            return Err(CoreError::EmptyManifestName);
        }
        if self.version.trim().is_empty() {
            return Err(CoreError::EmptyManifestVersion);
        }
        Ok(())
    }

    pub fn supports(&self, resource: &str, media_type: &str, id: &str) -> bool {
        self.resources.iter().any(|candidate| match candidate {
            ManifestResource::Name(name) => name == resource,
            ManifestResource::Detailed(details) => {
                details.name == resource
                    && (details.types.is_empty()
                        || details.types.iter().any(|value| value == media_type))
                    && (details.id_prefixes.is_empty()
                        || details
                            .id_prefixes
                            .iter()
                            .any(|prefix| id.starts_with(prefix)))
            }
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ManifestResource {
    Name(String),
    Detailed(AddonResource),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonResource {
    pub name: String,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub id_prefixes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDescriptor {
    pub id: String,
    #[serde(rename = "type")]
    pub media_type: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub extra: Vec<CatalogExtra>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogExtra {
    pub name: String,
    #[serde(default)]
    pub is_required: bool,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub options_limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonDescriptor {
    pub manifest_url: String,
    pub manifest: AddonManifest,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(resources: Vec<ManifestResource>) -> AddonManifest {
        AddonManifest {
            id: "org.test".into(),
            version: "1".into(),
            name: "Test".into(),
            description: None,
            logo: None,
            background: None,
            resources,
            types: vec!["movie".into()],
            catalogs: vec![],
            id_prefixes: vec![],
        }
    }

    #[test]
    fn matches_simple_resource() {
        assert!(manifest(vec![ManifestResource::Name("stream".into())])
            .supports("stream", "series", "anything"));
    }

    #[test]
    fn applies_type_and_prefix_constraints() {
        let subject = manifest(vec![ManifestResource::Detailed(AddonResource {
            name: "stream".into(),
            types: vec!["movie".into()],
            id_prefixes: vec!["tt".into()],
        })]);

        assert!(subject.supports("stream", "movie", "tt123"));
        assert!(!subject.supports("stream", "series", "tt123"));
        assert!(!subject.supports("stream", "movie", "kitsu:123"));
    }
}
