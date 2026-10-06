mod support;
use conduit_p2p::{Engine, Phase, Source, StartRequest};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn local_swarm_streams_ranges_before_completion_and_closes_without_leaks() {
    let seed_dir = tempfile::tempdir().unwrap();
    let path = seed_dir.path().join("movie.mp4");
    let bytes = (0..8 * 1024 * 1024)
        .map(|i| ((i * 31 + i / 113) % 251) as u8)
        .collect::<Vec<_>>();
    std::fs::write(&path, &bytes).unwrap();
    let swarm = support::swarm(&path, "127.0.0.1".parse().unwrap(), 0)
        .await
        .unwrap();
    let cache = tempfile::tempdir().unwrap();
    let mut engine = Engine::start(StartRequest {
        source: Source {
            info_hash: None,
            magnet: Some(swarm.magnet),
            file_index: None,
            sources: vec![],
        },
        cache_directory: cache.path().into(),
    })
    .unwrap();
    let url = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let status = engine.status();
            if let Some(url) = status.stream_url {
                return url;
            }
            assert!(!matches!(status.phase, Phase::Failed), "{:?}", status.error);
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(url.replace(url.rsplit('/').next().unwrap(), "bad-token"))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let head = client.head(&url).send().await.unwrap();
    assert_eq!(head.headers()["content-length"], bytes.len().to_string());
    for (start, end) in [
        (0, 1023),
        (bytes.len() - 4096, bytes.len() - 1),
        (1024 * 1024, 1024 * 1024 + 1023),
        (128, 255),
    ] {
        let response = client
            .get(&url)
            .header("Range", format!("bytes={start}-{end}"))
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(
            response.headers()["content-range"],
            format!("bytes {start}-{end}/{}", bytes.len())
        );
        assert_eq!(&response.bytes().await.unwrap()[..], &bytes[start..=end]);
    }
    assert!(
        engine.status().verified_bytes < bytes.len() as u64,
        "streaming must not require the full download"
    );
    assert_eq!(
        client
            .get(&url)
            .header("Range", format!("bytes={}-", bytes.len()))
            .send()
            .await
            .unwrap()
            .status(),
        416
    );
    engine.set_paused(true);
    tokio::time::sleep(Duration::from_millis(750)).await;
    assert!(matches!(engine.status().phase, Phase::Paused));
    engine.set_paused(false);
    let response = client
        .get(&url)
        .header("Range", "bytes=0-31")
        .send()
        .await
        .unwrap();
    assert_eq!(&response.bytes().await.unwrap()[..], &bytes[..32]);
    tokio::task::spawn_blocking(move || engine.close())
        .await
        .unwrap();
    assert!(client.get(&url).send().await.is_err());
    assert_eq!(
        std::fs::read_dir(cache.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().unwrap().is_dir())
            .count(),
        0
    );
    swarm.server.abort();
    swarm.seed.stop().await;
}

#[test]
fn unresolved_metadata_can_be_cancelled_promptly() {
    let cache = tempfile::tempdir().unwrap();
    let mut engine = Engine::start(StartRequest {
        source: Source {
            info_hash: None,
            magnet: Some(format!(
                "magnet:?xt=urn:btih:{}&tr=http%3A%2F%2F127.0.0.1%3A9%2Fannounce",
                "a".repeat(40)
            )),
            file_index: None,
            sources: vec![],
        },
        cache_directory: cache.path().into(),
    })
    .unwrap();
    let start = std::time::Instant::now();
    engine.close();
    assert!(start.elapsed() < Duration::from_secs(4));
    assert_eq!(
        std::fs::read_dir(cache.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().unwrap().is_dir())
            .count(),
        0
    );
}

#[test]
fn cache_ownership_preserves_active_sessions_and_sweeps_orphans() {
    let cache = tempfile::tempdir().unwrap();
    let orphan = cache.path().join("conduit-p2p-orphan");
    std::fs::create_dir(&orphan).unwrap();
    std::fs::write(orphan.join("partial"), "abandoned").unwrap();
    let unrelated = cache.path().join("unrelated");
    std::fs::create_dir(&unrelated).unwrap();
    let request = StartRequest {
        source: Source {
            info_hash: None,
            magnet: Some(format!(
                "magnet:?xt=urn:btih:{}&tr=http%3A%2F%2F127.0.0.1%3A9%2Fannounce",
                "a".repeat(40)
            )),
            file_index: None,
            sources: vec![],
        },
        cache_directory: cache.path().into(),
    };
    let mut engine = Engine::start(request.clone()).unwrap();
    assert!(!orphan.exists());
    assert!(unrelated.exists());
    assert!(Engine::start(request.clone()).is_err());
    engine.close();
    let mut next = Engine::start(request).unwrap();
    next.close();
    assert!(unrelated.exists());
}
