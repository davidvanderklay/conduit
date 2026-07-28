use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("invalid manifest URL: {0}")]
    InvalidManifestUrl(#[from] url::ParseError),
    #[error("invalid add-on response: {0}")]
    InvalidResponse(#[from] serde_json::Error),
    #[error("manifest id cannot be empty")]
    EmptyManifestId,
    #[error("manifest name cannot be empty")]
    EmptyManifestName,
    #[error("manifest version cannot be empty")]
    EmptyManifestVersion,
    #[error("manifest URL must end in manifest.json")]
    InvalidManifestPath,
}
