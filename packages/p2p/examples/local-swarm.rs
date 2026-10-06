//! Controlled swarm for native-player verification. Pass a media file you own.
#[path = "../tests/support/mod.rs"]
mod support;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let path = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("usage: local-swarm <owned-media-file>"))?;
    let ip = std::env::var("CONDUIT_FIXTURE_HOST")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()?;
    let swarm = support::swarm(std::path::Path::new(&path), ip, 18847).await?;
    assert!(!swarm.magnet.is_empty());
    println!("Fixture source: http://{ip}:18847/source.json");
    tokio::signal::ctrl_c().await?;
    swarm.server.abort();
    swarm.seed.stop().await;
    Ok(())
}
