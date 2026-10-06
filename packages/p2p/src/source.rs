use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub info_hash: Option<String>,
    pub magnet: Option<String>,
    pub file_index: Option<usize>,
    #[serde(default)]
    pub sources: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub index: usize,
    pub name: String,
    pub size: u64,
}

impl Source {
    /// Normalize discovery hints before they enter the engine. Never log the result.
    pub fn magnet_url(&self) -> Result<String> {
        ensure!(self.sources.len() <= 32, "too many discovery sources");
        let mut url = if let Some(magnet) = &self.magnet {
            ensure!(magnet.len() <= 16 * 1024, "magnet exceeds input limit");
            let url = Url::parse(magnet).context("invalid magnet")?;
            ensure!(url.scheme() == "magnet", "expected a magnet URL");
            url
        } else {
            let hash = self
                .info_hash
                .as_deref()
                .context("missing torrent source")?;
            ensure!(valid_hash(hash), "invalid info hash");
            Url::parse(&format!("magnet:?xt=urn:btih:{}", hash.to_lowercase()))?
        };
        let pairs = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect::<Vec<_>>();
        ensure!(pairs.len() <= 64, "too many magnet parameters");
        let mut found_hash = false;
        url.set_query(None);
        for (key, value) in pairs {
            match key.as_str() {
                "xt" => {
                    let hash = value
                        .strip_prefix("urn:btih:")
                        .context("unsupported torrent hash")?;
                    ensure!(valid_hash(hash), "invalid info hash");
                    ensure!(!found_hash, "multiple torrent hashes");
                    if let Some(expected) = &self.info_hash {
                        ensure!(
                            expected.eq_ignore_ascii_case(hash),
                            "conflicting torrent hashes"
                        );
                    }
                    found_hash = true;
                    url.query_pairs_mut()
                        .append_pair("xt", &format!("urn:btih:{}", hash.to_lowercase()));
                }
                "tr" => {
                    validate_tracker(&value)?;
                    url.query_pairs_mut().append_pair("tr", &value);
                }
                "dn" => {
                    ensure!(value.len() <= 512, "torrent name exceeds input limit");
                }
                // Do not let magnets choose files, inject peers, or fetch arbitrary URLs.
                _ => bail!("unsupported magnet parameter"),
            }
        }
        ensure!(found_hash, "missing info hash");
        for source in &self.sources {
            if let Some(tracker) = source.strip_prefix("tracker:") {
                validate_tracker(tracker)?;
                url.query_pairs_mut().append_pair("tr", tracker);
            } else if let Some(hash) = source.strip_prefix("dht:") {
                ensure!(valid_hash(hash), "invalid discovery hash");
                let expected = url
                    .query_pairs()
                    .find(|(k, _)| k == "xt")
                    .unwrap()
                    .1
                    .into_owned();
                ensure!(
                    expected[9..].eq_ignore_ascii_case(hash),
                    "conflicting discovery hash"
                );
            } else {
                bail!("unsupported discovery source");
            }
        }
        Ok(url.to_string())
    }
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

fn validate_tracker(value: &str) -> Result<()> {
    ensure!(value.len() <= 2048, "tracker exceeds input limit");
    let url = Url::parse(value).context("invalid tracker")?;
    ensure!(
        matches!(url.scheme(), "http" | "https" | "udp") && url.host_str().is_some(),
        "unsupported tracker"
    );
    ensure!(
        url.username().is_empty() && url.password().is_none(),
        "tracker credentials are unsupported"
    );
    ensure!(url.fragment().is_none(), "invalid tracker fragment");
    Ok(())
}

pub fn select_file(files: &[MediaFile], requested: Option<usize>) -> Result<usize> {
    let selected = match requested {
        Some(index) => files
            .iter()
            .find(|f| f.index == index)
            .context("invalid file index")?,
        None => files
            .iter()
            .max_by_key(|f| f.size)
            .context("torrent has no files")?,
    };
    ensure!(selected.size > 0, "empty media file");
    let ext = selected
        .name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    ensure!(
        matches!(
            ext.as_str(),
            "mkv" | "mp4" | "m4v" | "avi" | "webm" | "mov" | "ts" | "m2ts" | "mpg" | "mpeg"
        ),
        "selected file is not supported media"
    );
    Ok(selected.index)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_and_preserves_discovery_without_peer_injection() {
        let mut source = Source {
            info_hash: Some("a".repeat(40)),
            magnet: None,
            file_index: None,
            sources: vec!["tracker:https://example.com/announce?pass=secret".into()],
        };
        assert!(source.magnet_url().unwrap().contains("tr="));
        source.magnet = Some(format!(
            "magnet:?xt=urn:btih:{}&x.pe=127.0.0.1:80",
            "a".repeat(40)
        ));
        assert!(source.magnet_url().is_err());
        source.magnet = None;
        source.sources = vec![format!("dht:{}", "b".repeat(40))];
        assert!(source.magnet_url().is_err());
    }
    #[test]
    fn largest_default_does_not_silently_pick_another_file() {
        let files = vec![
            MediaFile {
                index: 0,
                name: "movie.mkv".into(),
                size: 100,
            },
            MediaFile {
                index: 1,
                name: "payload.exe".into(),
                size: 200,
            },
        ];
        assert!(select_file(&files, None).is_err());
        assert_eq!(select_file(&files, Some(0)).unwrap(), 0);
        assert!(select_file(&files, Some(2)).is_err());
    }
}
