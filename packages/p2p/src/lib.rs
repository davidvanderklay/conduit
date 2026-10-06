mod http;
mod source;
mod storage;

use anyhow::{Context, Result};
use librqbit::storage::StorageFactoryExt;
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, Session, SessionOptions};
use serde::{Deserialize, Serialize};
pub use source::{MediaFile, Source};
use std::{
    num::NonZeroU32,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::Duration,
};
use tokio::sync::{watch, Semaphore};
use tokio_util::sync::CancellationToken;

const DISK_BUDGET: u64 = 4 * 1024 * 1024 * 1024;
const FREE_RESERVE: u64 = 256 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub source: Source,
    pub cache_directory: PathBuf,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    pub stream_url: Option<String>,
    pub files: Vec<MediaFile>,
    pub file_index: Option<usize>,
    pub verified_bytes: u64,
    pub download_bytes_per_second: u64,
    pub disk_budget: u64,
    pub disk_bytes: u64,
    pub ready_ahead_bytes: u64,
    pub peers: u32,
    pub error: Option<&'static str>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    Resolving,
    Ready,
    Paused,
    Failed,
    Closed,
}

/// Owns one worker and one torrent. Cancelling drops the metadata/read futures;
/// close joins that worker before its private temporary directory is removed.
pub struct Engine {
    status: Arc<Mutex<Status>>,
    cancel: CancellationToken,
    pause: watch::Sender<bool>,
    worker: Option<JoinHandle<()>>,
}

impl Engine {
    pub fn start(request: StartRequest) -> Result<Self> {
        let magnet = request.source.magnet_url()?;
        std::fs::create_dir_all(&request.cache_directory).context("private cache unavailable")?;
        // A persistent lock prevents one handle from sweeping another handle's
        // active cache. Only our generated session directories are reclaimed.
        let ownership = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(request.cache_directory.join(".owner"))?;
        fs2::FileExt::try_lock_exclusive(&ownership).context("another P2P session is active")?;
        for entry in std::fs::read_dir(&request.cache_directory)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("conduit-p2p-")
                && entry.file_type()?.is_dir()
            {
                std::fs::remove_dir_all(entry.path())?;
            }
        }
        let directory = tempfile::Builder::new()
            .prefix("conduit-p2p-")
            .tempdir_in(&request.cache_directory)?;
        let budget = fs2::available_space(directory.path())?
            .saturating_sub(FREE_RESERVE)
            .min(DISK_BUDGET);
        anyhow::ensure!(budget > 0, "insufficient free storage");
        let status = Arc::new(Mutex::new(Status {
            disk_budget: budget,
            ..Default::default()
        }));
        let cancel = CancellationToken::new();
        let (pause, pause_rx) = watch::channel(false);
        let worker_status = status.clone();
        let worker_cancel = cancel.clone();
        let worker = std::thread::Builder::new()
            .name("conduit-p2p".into())
            .spawn(move || {
                let result = (|| -> Result<()> {
                    let runtime = tokio::runtime::Builder::new_multi_thread()
                        .worker_threads(2)
                        .max_blocking_threads(2)
                        .enable_all()
                        .build()?;
                    runtime.block_on(run(
                        magnet,
                        request.source.file_index,
                        directory.path().to_path_buf(),
                        budget,
                        worker_status.clone(),
                        worker_cancel.clone(),
                        pause_rx,
                    ))
                })();
                // Engine errors can contain peer addresses, hashes, tracker passwords,
                // and file paths. Publish stable codes, never their Debug/Display text.
                let mut state = worker_status.lock().unwrap();
                state.stream_url = None;
                if result.is_err() {
                    state.phase = Phase::Failed;
                    if state.error.is_none() {
                        state.error = Some("p2p_session_failed");
                    }
                } else {
                    state.phase = Phase::Closed;
                }
                drop(state);
                drop(directory);
                drop(ownership);
            })?;
        Ok(Self {
            status,
            cancel,
            pause,
            worker: Some(worker),
        })
    }
    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }
    pub fn set_paused(&self, paused: bool) {
        self.pause.send_replace(paused);
    }
    pub fn close(&mut self) {
        self.cancel.cancel();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        self.close();
    }
}

async fn run(
    magnet: String,
    index: Option<usize>,
    directory: PathBuf,
    budget: u64,
    state: Arc<Mutex<Status>>,
    cancel: CancellationToken,
    mut pause: watch::Receiver<bool>,
) -> Result<()> {
    let session = Session::new_with_opts(
        directory.clone(),
        SessionOptions {
            // Metadata discovery uses DHT without persistent state. Private torrents
            // must supply a tracker and the engine honors their private flag.
            dht: if magnet.contains("tr=") {
                None
            } else {
                Some(librqbit::DhtSessionConfig {
                    persistence: None,
                    ..Default::default()
                })
            },
            disable_local_service_discovery: true,
            disable_upload: true,
            peer_limit: Some(32),
            concurrent_init_limit: Some(1),
            runtime_worker_threads: Some(2),
            cancellation_token: Some(cancel.child_token()),
            default_storage_factory: Some(storage::BoundedStorage(budget).boxed()),
            ratelimits: librqbit::limits::LimitsConfig {
                download_bps: NonZeroU32::new(8 * 1024 * 1024),
                upload_bps: NonZeroU32::new(1),
            },
            ..Default::default()
        },
    )
    .await?;
    let result = serve(
        &session,
        magnet,
        index,
        directory,
        state,
        cancel,
        pause.clone(),
    )
    .await;
    // All exit paths stop engine I/O, including failed selection and initialization.
    session.stop().await;
    // Close sender is owned by the host. Keep receiver alive until shutdown.
    pause.borrow_and_update();
    result
}

async fn serve(
    session: &Arc<Session>,
    magnet: String,
    index: Option<usize>,
    directory: PathBuf,
    state: Arc<Mutex<Status>>,
    cancel: CancellationToken,
    mut pause: watch::Receiver<bool>,
) -> Result<()> {
    let resolved = tokio::select! {
        _=cancel.cancelled()=>return Ok(()),
        result=tokio::time::timeout(Duration::from_secs(60),session.add_torrent(AddTorrent::from_url(magnet),Some(AddTorrentOptions{list_only:true,..Default::default()})))=>result??,
    };
    let AddTorrentResponse::ListOnly(metadata) = resolved else {
        anyhow::bail!("expected metadata");
    };
    anyhow::ensure!(
        metadata.torrent_bytes.len() <= 1024 * 1024,
        "metadata exceeds limit"
    );
    anyhow::ensure!(
        metadata.info.iter_file_details_ext().count() <= 256,
        "too many files"
    );
    let files = metadata
        .info
        .iter_file_details_ext()
        .enumerate()
        .map(|(index, file)| MediaFile {
            index,
            name: file
                .details
                .filename
                .to_pathbuf()
                .to_string_lossy()
                .into_owned(),
            size: file.details.len,
        })
        .collect::<Vec<_>>();
    {
        state.lock().unwrap().files = files.clone();
    }
    let selected = match source::select_file(&files, index) {
        Ok(index) => index,
        Err(error) => {
            state.lock().unwrap().error = Some("p2p_file_selection");
            return Err(error);
        }
    };
    let size = files[selected].size;
    let torrent = session
        .add_torrent(
            AddTorrent::from_bytes(metadata.torrent_bytes),
            Some(AddTorrentOptions {
                only_files: Some(vec![selected]),
                initial_peers: Some(metadata.seen_peers),
                ..Default::default()
            }),
        )
        .await?
        .into_handle()
        .context("torrent not added")?;
    tokio::select! { _=cancel.cancelled()=>return Ok(()), result=tokio::time::timeout(Duration::from_secs(30),torrent.wait_until_initialized())=>result?? }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let token = format!("{:032x}", rand::random::<u128>());
    let url = format!("http://127.0.0.1:{}/{token}", listener.local_addr()?.port());
    {
        let mut s = state.lock().unwrap();
        s.phase = Phase::Ready;
        s.stream_url = Some(url);
        s.file_index = Some(selected);
    }
    let read_position = Arc::new(AtomicU64::new(0));
    let api = librqbit::Api::new(session.clone(), None);
    let route = http::StreamRoute {
        torrent: torrent.clone(),
        file_index: selected,
        size,
        read_position: read_position.clone(),
        cancel: cancel.clone(),
        readers: Arc::new(Semaphore::new(4)),
    };
    let app = http::router(&token, route);
    let server_cancel = cancel.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(server_cancel.cancelled_owned())
            .await
    });
    let mut timer = tokio::time::interval(Duration::from_millis(500));
    let mut paused = false;
    let result = loop {
        tokio::select! {
            _=cancel.cancelled()=>break Ok(()),
            change=pause.changed()=> {
                if change.is_err(){break Ok(());}
                let requested=*pause.borrow_and_update();
                if requested!=paused {
                    let result=if requested{session.pause(&torrent).await}else{session.unpause(&torrent).await};
                    if let Err(error)=result{break Err(error);}
                    paused=requested;
                }
            }
            _=timer.tick()=> {
                let stats=torrent.stats();
                if stats.error.is_some(){break Err(anyhow::anyhow!("torrent failed"));}
                let mut s=state.lock().unwrap();
                s.phase=if paused{Phase::Paused}else{Phase::Ready};
                s.verified_bytes=stats.progress_bytes;
                s.disk_bytes = allocated_bytes(&directory).unwrap_or(0);
                if s.disk_bytes > s.disk_budget || fs2::available_space(&directory).unwrap_or(0) < FREE_RESERVE {
                    s.error = Some("p2p_storage_limit");
                    break Err(anyhow::anyhow!("storage limit reached"));
                }
                s.ready_ahead_bytes = torrent.with_metadata(|metadata| {
                    let position = read_position.load(Ordering::Relaxed).min(size);
                    let offset = metadata.file_infos[selected].offset_in_torrent;
                    let piece_length = metadata.lengths().default_piece_length() as u64;
                    let Ok((haves,_)) = api.api_dump_haves(librqbit::api::TorrentIdOrHash::Id(torrent.id())) else { return 0; };
                    let mut end = position;
                    while end < size && end - position < 32 * 1024 * 1024 {
                        let piece = (offset + end) / piece_length;
                        if !haves.get(piece as usize).is_some_and(|bit| *bit) { break; }
                        end = ((piece + 1) * piece_length).saturating_sub(offset).min(size);
                    }
                    end - position
                }).unwrap_or(0);
                s.peers = stats.live.as_ref().map(|l| l.snapshot.peer_stats.live).unwrap_or(0);
                s.download_bytes_per_second=stats.live.map(|l|(l.download_speed.mbps*1024.0*1024.0) as u64).unwrap_or(0);
            }
        }
    };
    cancel.cancel();
    let _ = tokio::time::timeout(Duration::from_secs(2), server).await;
    result
}

fn allocated_bytes(directory: &std::path::Path) -> std::io::Result<u64> {
    let mut total = 0;
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            total += allocated_bytes(&entry.path())?;
        } else {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                total += metadata.blocks() * 512;
            }
            #[cfg(not(unix))]
            {
                total += metadata.len();
            }
        }
    }
    Ok(total)
}
