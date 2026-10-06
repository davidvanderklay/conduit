use anyhow::Result;
use axum::{body::Body, http::Response, routing::get, Router};
use librqbit::{
    AddTorrent, AddTorrentOptions, CreateTorrentOptions, ListenerOptions, Session, SessionOptions,
};
use std::{
    net::{Ipv4Addr, SocketAddr},
    num::NonZeroU32,
    path::Path,
    sync::Arc,
};

pub struct Swarm {
    pub seed: Arc<Session>,
    pub magnet: String,
    pub server: tokio::task::JoinHandle<std::io::Result<()>>,
}

/// A local tracker returns only our seeded peer. No DHT, LSD, or public trackers.
pub async fn swarm(path: &Path, advertised_ip: Ipv4Addr, tracker_port: u16) -> Result<Swarm> {
    let port = std::net::TcpListener::bind("0.0.0.0:0")?
        .local_addr()?
        .port();
    let seed = Session::new_with_opts(
        path.parent().unwrap().to_owned(),
        SessionOptions {
            dht: None,
            disable_local_service_discovery: true,
            disable_upload: false,
            listen: Some(ListenerOptions {
                listen_addr: SocketAddr::from(([0, 0, 0, 0], port)),
                ipv4_only: true,
                ..Default::default()
            }),
            ratelimits: librqbit::limits::LimitsConfig {
                upload_bps: NonZeroU32::new(256 * 1024),
                download_bps: None,
            },
            ..Default::default()
        },
    )
    .await?;
    let created = librqbit::create_torrent(
        path,
        CreateTorrentOptions {
            piece_length: Some(64 * 1024),
            ..Default::default()
        },
        &librqbit::spawn_utils::BlockingSpawner::new(2),
    )
    .await?;
    let handle = seed
        .add_torrent(
            AddTorrent::from_bytes(created.as_bytes()?),
            Some(AddTorrentOptions {
                overwrite: true,
                disable_trackers: true,
                ..Default::default()
            }),
        )
        .await?
        .into_handle()
        .unwrap();
    handle.wait_until_initialized().await?;
    let tracker = tokio::net::TcpListener::bind(("0.0.0.0", tracker_port)).await?;
    let tracker_port = tracker.local_addr()?.port();
    let magnet = format!(
        "magnet:?xt=urn:btih:{}&tr=http%3A%2F%2F{advertised_ip}%3A{tracker_port}%2Fannounce",
        created.info_hash().as_string()
    );
    let mut response = b"d8:intervali5e5:peers6:".to_vec();
    response.extend(advertised_ip.octets());
    response.extend(port.to_be_bytes());
    response.push(b'e');
    let source = serde_json::json!({"url":magnet,"name":"Conduit local P2P fixture"}).to_string();
    let app = Router::new()
        .route(
            "/announce",
            get(move || {
                let bytes = response.clone();
                async move { Response::new(Body::from(bytes)) }
            }),
        )
        .route(
            "/source.json",
            get(move || {
                let source = source.clone();
                async move {
                    Response::builder()
                        .header("content-type", "application/json")
                        .body(Body::from(source))
                        .unwrap()
                }
            }),
        );
    let server = tokio::spawn(async move { axum::serve(tracker, app).await });
    Ok(Swarm {
        seed,
        magnet,
        server,
    })
}
