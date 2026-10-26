use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

/// A home catalog row offered by an add-on. Host fields pass through unchanged.
#[derive(Debug, Clone, Deserialize)]
pub struct HomeCatalog {
    pub key: String,
    pub title: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A profile's saved choice for one home row. Saved order is display order.
#[derive(Debug, Clone, Deserialize)]
pub struct HomeRowSetting {
    pub key: String,
    pub enabled: bool,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeRow {
    pub key: String,
    /// The custom title when one is saved, otherwise the add-on's title.
    pub title: String,
    pub default_title: String,
    pub enabled: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Applies a profile's saved order, titles, and visibility to the offered catalogs.
/// Catalogs without a saved setting follow the saved ones in add-on order and
/// start enabled. Settings for catalogs that are no longer offered are ignored.
pub fn arrange_home_rows(catalogs: Vec<HomeCatalog>, settings: &[HomeRowSetting]) -> Vec<HomeRow> {
    let mut saved = HashMap::new();
    for (position, setting) in settings.iter().enumerate() {
        saved
            .entry(setting.key.as_str())
            .or_insert((position, setting));
    }
    let mut rows: Vec<_> = catalogs
        .into_iter()
        .map(|catalog| {
            let setting = saved.get(catalog.key.as_str()).copied();
            let title = setting
                .and_then(|(_, setting)| setting.title.as_deref())
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .unwrap_or(&catalog.title)
                .to_owned();
            let row = HomeRow {
                title,
                enabled: setting.is_none_or(|(_, setting)| setting.enabled),
                key: catalog.key,
                default_title: catalog.title,
                extra: catalog.extra,
            };
            (setting.map_or(usize::MAX, |(position, _)| position), row)
        })
        .collect();
    rows.sort_by_key(|(position, _)| *position);
    rows.into_iter().map(|(_, row)| row).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog(key: &str) -> HomeCatalog {
        HomeCatalog {
            key: key.into(),
            title: key.to_uppercase(),
            extra: Map::new(),
        }
    }

    fn setting(key: &str, enabled: bool, title: Option<&str>) -> HomeRowSetting {
        HomeRowSetting {
            key: key.into(),
            enabled,
            title: title.map(Into::into),
        }
    }

    #[test]
    fn applies_saved_order_titles_and_visibility() {
        let rows = arrange_home_rows(
            vec![catalog("a"), catalog("b"), catalog("new"), catalog("c")],
            &[
                setting("c", true, Some("  Picks ")),
                setting("gone", true, None),
                setting("a", false, Some(" ")),
                setting("b", true, None),
            ],
        );
        let summary: Vec<_> = rows
            .iter()
            .map(|row| (row.key.as_str(), row.title.as_str(), row.enabled))
            .collect();
        assert_eq!(
            summary,
            [
                ("c", "Picks", true),
                ("a", "A", false),
                ("b", "B", true),
                ("new", "NEW", true),
            ]
        );
        assert_eq!(rows[0].default_title, "C");
    }

    #[test]
    fn keeps_add_on_order_without_settings() {
        let rows = arrange_home_rows(vec![catalog("b"), catalog("a")], &[]);
        assert_eq!(rows[0].key, "b");
        assert!(rows.iter().all(|row| row.enabled));
    }
}
