use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use librqbit::ManagedTorrent;
use std::{
    io::SeekFrom,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt},
    sync::Semaphore,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub(crate) struct StreamRoute {
    pub torrent: Arc<ManagedTorrent>,
    pub file_index: usize,
    pub size: u64,
    pub read_position: Arc<AtomicU64>,
    pub cancel: CancellationToken,
    pub readers: Arc<Semaphore>,
}

pub(crate) fn router(token: &str, route: StreamRoute) -> Router {
    Router::new()
        .route(&format!("/{token}"), get(read).head(head))
        .with_state(route)
}

/// A single byte range is enough for native players. Reject malformed and
/// multipart requests instead of guessing, and clamp a valid end to EOF.
fn byte_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if size == 0 {
        return None;
    }
    if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        return (suffix > 0).then_some((size.saturating_sub(suffix), size - 1));
    }
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    (start < size && end >= start).then_some((start, end))
}

fn headers(status: StatusCode, size: u64, range: Option<(u64, u64)>, body: Body) -> Response {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let h = response.headers_mut();
    h.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    h.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    h.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    let length = range.map(|(s, e)| e - s + 1).unwrap_or(size);
    h.insert(header::CONTENT_LENGTH, length.to_string().parse().unwrap());
    if let Some((start, end)) = range {
        h.insert(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{size}").parse().unwrap(),
        );
    }
    response
}

async fn head(State(route): State<StreamRoute>) -> Response {
    headers(StatusCode::OK, route.size, None, Body::empty())
}

async fn read(State(route): State<StreamRoute>, request_headers: HeaderMap) -> Response {
    let range = match request_headers.get(header::RANGE) {
        Some(value) => match value.to_str().ok().and_then(|s| byte_range(s, route.size)) {
            Some(range) => Some(range),
            None => {
                let mut response = Response::new(Body::empty());
                *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
                response.headers_mut().insert(
                    header::CONTENT_RANGE,
                    format!("bytes */{}", route.size).parse().unwrap(),
                );
                return response;
            }
        },
        None => None,
    };
    let permit = match route.readers.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            let mut r = Response::new(Body::empty());
            *r.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
            return r;
        }
    };
    let (start, end) = range.unwrap_or((0, route.size - 1));
    let mut file = match tokio::time::timeout(
        Duration::from_secs(10),
        route.torrent.clone().stream(route.file_index),
    )
    .await
    {
        Ok(Ok(file)) => file,
        _ => {
            let mut r = Response::new(Body::empty());
            *r.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
            return r;
        }
    };
    if file.seek(SeekFrom::Start(start)).await.is_err() {
        let mut r = Response::new(Body::empty());
        *r.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
        return r;
    }
    let stream = async_stream::try_stream! {
        let _permit = permit;
        let mut remaining=end-start+1;
        while remaining>0 {
            let mut buffer=vec![0u8; (64*1024).min(remaining as usize)];
            let count = tokio::select! {
                _ = route.cancel.cancelled() => Err(std::io::Error::new(std::io::ErrorKind::Interrupted,"session closed")),
                result = tokio::time::timeout(Duration::from_secs(30),file.read(&mut buffer)) => result.unwrap_or_else(|_|Err(std::io::Error::new(std::io::ErrorKind::TimedOut,"peer read stalled"))),
            }?;
            if count==0 { Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof,"incomplete media"))?; }
            buffer.truncate(count);
            remaining -= count as u64;
            route.read_position.store(end + 1 - remaining, Ordering::Relaxed);
            yield buffer;
        }
    };
    headers(
        if range.is_some() {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        },
        route.size,
        range,
        Body::from_stream::<
            std::pin::Pin<Box<dyn futures_core::Stream<Item = std::io::Result<Vec<u8>>> + Send>>,
        >(Box::pin(stream)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_player_ranges_are_exact_and_bounded() {
        assert_eq!(byte_range("bytes=4-8", 10), Some((4, 8)));
        assert_eq!(byte_range("bytes=4-", 10), Some((4, 9)));
        assert_eq!(byte_range("bytes=-4", 10), Some((6, 9)));
        assert_eq!(byte_range("bytes=4-100", 10), Some((4, 9)));
        for s in [
            "bytes=10-",
            "bytes=8-4",
            "bytes=-0",
            "bytes=0-1,4-5",
            "bytes=1-x",
        ] {
            assert_eq!(byte_range(s, 10), None);
        }
    }
}
