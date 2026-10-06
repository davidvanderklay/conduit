use anyhow::{ensure, Result};
use librqbit::storage::filesystem::{FilesystemStorage, FilesystemStorageFactory};
use librqbit::storage::{BoxStorageFactory, StorageFactory, StorageFactoryExt};
use librqbit::{ManagedTorrentShared, TorrentMetadata};
use std::path::{Component, Path};

/// Reject the entire torrent before storage initialization. This deliberately
/// budgets all files, including pieces overlapping the selected file's boundary.
#[derive(Clone)]
pub(crate) struct BoundedStorage(pub u64);

impl StorageFactory for BoundedStorage {
    type Storage = FilesystemStorage;
    fn create(
        &self,
        shared: &ManagedTorrentShared,
        metadata: &TorrentMetadata,
    ) -> Result<Self::Storage> {
        ensure!(
            metadata.torrent_bytes.len() <= 1024 * 1024,
            "metadata exceeds limit"
        );
        ensure!(metadata.file_infos.len() <= 256, "too many torrent files");
        ensure!(
            reservation(metadata.file_infos.iter().map(|file| file.len))
                .is_some_and(|bytes| bytes <= self.0),
            "torrent exceeds storage budget"
        );
        ensure!(
            metadata.lengths().total_pieces() <= 262144,
            "too many torrent pieces"
        );
        let mut paths = std::collections::HashSet::new();
        for file in &metadata.file_infos {
            ensure!(!file.attrs.symlink, "torrent symlinks are unsupported");
            ensure!(
                paths.insert(file.relative_filename.clone()),
                "duplicate torrent path"
            );
            ensure!(safe_path(&file.relative_filename), "unsafe torrent path");
        }
        FilesystemStorageFactory::default().create(shared, metadata)
    }
    fn clone_box(&self) -> BoxStorageFactory {
        self.clone().boxed()
    }
}

// Reserve complete files, rounded to 4 KiB, plus room for metadata and
// filesystem overhead. Sparse allocation cannot bypass this admission check.
fn reservation(mut lengths: impl Iterator<Item = u64>) -> Option<u64> {
    lengths.try_fold(16_u64 * 1024 * 1024, |total, length| {
        total.checked_add(length.checked_add(4095)? / 4096 * 4096)
    })
}

fn safe_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path.as_os_str().len() <= 1024
        && path.components().count() <= 16
        && path.components().all(|p| matches!(p, Component::Normal(_)))
        && !path.to_string_lossy().contains('\\')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reserves_all_files_and_rejects_overflow() {
        assert_eq!(
            reservation([1, 4097].into_iter()),
            Some(16 * 1024 * 1024 + 12288)
        );
        assert_eq!(reservation([u64::MAX].into_iter()), None);
    }
    #[test]
    fn rejects_paths_that_escape_private_storage() {
        for path in [
            "../movie.mkv",
            "/movie.mkv",
            "a/../../movie.mkv",
            "a\\..\\movie.mkv",
            "",
        ] {
            assert!(!safe_path(Path::new(path)), "{path}");
        }
        assert!(safe_path(Path::new("series/episode.mkv")));
    }
}
