//! Subtitle auto sync: lines up an add-on subtitle with the subtitle timing
//! embedded in the video, without decoding audio.
//!
//! Players read the video through [`subtitle_timeline`], which asks for byte
//! ranges until it has read the container's subtitle index (Matroska Cues or
//! MP4 sample tables). [`align_subtitle`] then finds the constant delay that
//! best maps the add-on subtitle's cue starts onto that timeline.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Smallest read the timeline asks for, so element headers rarely need a second request.
const PROBE_BYTES: u64 = 256 * 1024;
const MAX_ELEMENT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_ELEMENTS: usize = 64;
const MIN_CUES: usize = 20;
/// Matches the ±30 s range of the delay control.
const MAX_OFFSET_MS: i64 = 30_000;
const VOTE_BIN_MS: i64 = 100;
const MATCH_TOLERANCE_MS: i64 = 250;

/// Bytes a player already read from the video, base64 encoded.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteRange {
    pub offset: u64,
    pub data: String,
}

/// The next read the timeline needs, or the finished timeline.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TimelineStep {
    Need {
        offset: u64,
        length: u64,
    },
    /// Start times in milliseconds of the embedded subtitle track with the most cues.
    Timeline {
        starts: Vec<i64>,
    },
}

#[derive(Debug, PartialEq)]
pub enum TimelineError {
    /// Not Matroska or MP4, such as an HLS playlist.
    UnsupportedContainer,
    /// The container has no indexed subtitle track to compare against.
    NoSubtitleTiming,
    InvalidContainer(&'static str),
    InvalidRange,
}

impl TimelineError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedContainer => "unsupported_container",
            Self::NoSubtitleTiming => "no_subtitle_timing",
            Self::InvalidContainer(_) => "invalid_container",
            Self::InvalidRange => "invalid_range",
        }
    }
}

impl fmt::Display for TimelineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedContainer => f.write_str("only Matroska and MP4 videos can be synced"),
            Self::NoSubtitleTiming => f.write_str("the video has no indexed subtitle track"),
            Self::InvalidContainer(reason) => write!(f, "invalid container: {reason}"),
            Self::InvalidRange => f.write_str("a byte range is not valid base64"),
        }
    }
}

/// A constant delay that lines the add-on subtitle up with the embedded one.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleAlignment {
    /// Positive values show subtitles later, like the delay control.
    pub delay_ms: i64,
    /// Add-on cues that landed on an embedded cue after the delay.
    pub matched: usize,
    /// Add-on cues inside the embedded track's time span.
    pub compared: usize,
}

/// Reads the embedded subtitle timeline from the given byte ranges. `size` is
/// the video's total length when the server reported it.
pub fn subtitle_timeline(
    ranges: &[ByteRange],
    size: Option<u64>,
) -> Result<TimelineStep, TimelineError> {
    let ranges = ranges
        .iter()
        .map(|range| Ok((range.offset, decode_base64(&range.data)?)))
        .collect::<Result<Vec<_>, TimelineError>>()?;
    let bytes = Bytes { ranges, size };
    let result = match bytes.read(0, 12) {
        Ok(head) if head[..4] == [0x1A, 0x45, 0xDF, 0xA3] => matroska_timeline(&bytes),
        Ok(head) if is_mp4_box(&head[4..8]) => mp4_timeline(&bytes),
        Ok(_) => return Err(TimelineError::UnsupportedContainer),
        Err(stop) => Err(stop),
    };
    match result {
        Ok(starts) if starts.len() >= MIN_CUES => Ok(TimelineStep::Timeline { starts }),
        Ok(_) => Err(TimelineError::NoSubtitleTiming),
        Err(Stop::Need { offset, length }) => Ok(TimelineStep::Need { offset, length }),
        Err(Stop::Invalid(reason)) => Err(TimelineError::InvalidContainer(reason)),
    }
}

/// Finds the delay that makes `subtitle` cue starts land on `reference` cue
/// starts, both in milliseconds. Returns `None` unless one delay clearly wins
/// and matches at least 40% of the comparable cues.
pub fn align_subtitle(reference: &[i64], subtitle: &[i64]) -> Option<SubtitleAlignment> {
    let reference = sorted_unique(reference);
    let subtitle = sorted_unique(subtitle);
    if reference.len() < MIN_CUES || subtitle.len() < MIN_CUES {
        return None;
    }

    // Every nearby pair votes for the delay that would line it up.
    let bins = (2 * MAX_OFFSET_MS / VOTE_BIN_MS + 1) as usize;
    let mut votes = vec![0u32; bins];
    let mut low = 0;
    for &start in &subtitle {
        while low < reference.len() && reference[low] < start - MAX_OFFSET_MS {
            low += 1;
        }
        for &candidate in reference[low..]
            .iter()
            .take_while(|&&value| value <= start + MAX_OFFSET_MS)
        {
            let bin = (candidate - start + MAX_OFFSET_MS + VOTE_BIN_MS / 2) / VOTE_BIN_MS;
            votes[bin as usize] += 1;
        }
    }
    let score = |bin: usize| {
        votes[bin.saturating_sub(1)..=(bin + 1).min(bins - 1)]
            .iter()
            .sum::<u32>()
    };
    let best = (0..bins).max_by_key(|&bin| score(bin))?;
    let runner_up = (0..bins)
        .filter(|&bin| bin.abs_diff(best) > 10)
        .map(score)
        .max()
        .unwrap_or(0);
    if score(best) * 2 < runner_up * 3 {
        return None;
    }

    let center = best as i64 * VOTE_BIN_MS - MAX_OFFSET_MS;
    let mut offsets: Vec<i64> = subtitle
        .iter()
        .filter_map(|&start| {
            let gap = nearest(&reference, start + center)? - start;
            ((gap - center).abs() <= MATCH_TOLERANCE_MS).then_some(gap)
        })
        .collect();
    offsets.sort_unstable();
    let delay_ms = *offsets.get(offsets.len() / 2)?;
    let span = reference[0] - 2_000..=reference[reference.len() - 1] + 2_000;
    let compared = subtitle
        .iter()
        .filter(|&&start| span.contains(&(start + delay_ms)))
        .count();
    let matched = offsets.len();
    (compared >= MIN_CUES && matched * 10 >= compared * 4).then_some(SubtitleAlignment {
        delay_ms,
        matched,
        compared,
    })
}

/// Cue start times in milliseconds from SRT, WebVTT, or ASS/SSA text.
pub fn subtitle_starts(text: &str) -> Vec<i64> {
    let mut starts: Vec<i64> = text
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if let Some((start, _)) = line.split_once("-->") {
                parse_timestamp(start.trim())
            } else {
                parse_timestamp(line.strip_prefix("Dialogue:")?.split(',').nth(1)?.trim())
            }
        })
        .collect();
    starts.sort_unstable();
    starts.dedup();
    starts
}

/// Parses `HH:MM:SS,mmm`, `MM:SS.mmm`, or ASS `H:MM:SS.cc`.
fn parse_timestamp(value: &str) -> Option<i64> {
    let (clock, fraction) = value.split_once([',', '.']).unwrap_or((value, ""));
    let mut seconds = 0i64;
    let parts: Vec<&str> = clock.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    for part in parts {
        seconds = seconds * 60 + part.parse::<i64>().ok()?;
    }
    let digits = fraction.len().min(3);
    let millis = if digits == 0 {
        0
    } else {
        fraction[..digits].parse::<i64>().ok()? * 10i64.pow(3 - digits as u32)
    };
    Some(seconds * 1_000 + millis)
}

fn sorted_unique(values: &[i64]) -> Vec<i64> {
    let mut values = values.to_vec();
    values.sort_unstable();
    values.dedup();
    values
}

fn nearest(sorted: &[i64], target: i64) -> Option<i64> {
    let index = sorted.partition_point(|&value| value < target);
    [index.checked_sub(1), Some(index)]
        .into_iter()
        .flatten()
        .filter_map(|index| sorted.get(index).copied())
        .min_by_key(|value| (value - target).abs())
}

/// Why a read could not finish: more bytes are needed, or the data is broken.
enum Stop {
    Need { offset: u64, length: u64 },
    Invalid(&'static str),
}

struct Bytes {
    ranges: Vec<(u64, Vec<u8>)>,
    size: Option<u64>,
}

impl Bytes {
    fn read(&self, offset: u64, length: u64) -> Result<&[u8], Stop> {
        let end = offset
            .checked_add(length)
            .ok_or(Stop::Invalid("range overflow"))?;
        if let Some((start, data)) = self
            .ranges
            .iter()
            .find(|(start, data)| *start <= offset && end <= start + data.len() as u64)
        {
            let from = (offset - start) as usize;
            return Ok(&data[from..from + length as usize]);
        }
        if self.size.is_some_and(|size| end > size) {
            return Err(Stop::Invalid("read past the end of the video"));
        }
        let wanted = length.max(PROBE_BYTES);
        let length = self.size.map_or(wanted, |size| wanted.min(size - offset));
        Err(Stop::Need { offset, length })
    }

    /// Reads up to `length` bytes, fewer when the video ends sooner.
    fn read_up_to(&self, offset: u64, length: u64) -> Result<&[u8], Stop> {
        let length = self
            .size
            .map_or(length, |size| length.min(size.saturating_sub(offset)));
        self.read(offset, length)
    }
}

const ID_EBML: u64 = 0x1A45_DFA3;
const ID_SEGMENT: u64 = 0x1853_8067;
const ID_SEEK_HEAD: u64 = 0x114D_9B74;
const ID_SEEK: u64 = 0x4DBB;
const ID_SEEK_ID: u64 = 0x53AB;
const ID_SEEK_POSITION: u64 = 0x53AC;
const ID_INFO: u64 = 0x1549_A966;
const ID_TIMESTAMP_SCALE: u64 = 0x2A_D7B1;
const ID_TRACKS: u64 = 0x1654_AE6B;
const ID_TRACK_ENTRY: u64 = 0xAE;
const ID_TRACK_NUMBER: u64 = 0xD7;
const ID_TRACK_TYPE: u64 = 0x83;
const ID_CODEC_ID: u64 = 0x86;
const ID_CUES: u64 = 0x1C53_BB6B;
const ID_CUE_POINT: u64 = 0xBB;
const ID_CUE_TIME: u64 = 0xB3;
const ID_CUE_TRACK_POSITIONS: u64 = 0xB7;
const ID_CUE_TRACK: u64 = 0xF7;
const ID_CLUSTER: u64 = 0x1F43_B675;
const TRACK_TYPE_SUBTITLE: u64 = 0x11;

struct Element {
    id: u64,
    data_start: u64,
    size: Option<u64>,
}

/// Reads Matroska Cues for subtitle tracks. Muxers such as mkvmerge index
/// every subtitle block, so the Cues hold the whole subtitle timeline.
fn matroska_timeline(bytes: &Bytes) -> Result<Vec<i64>, Stop> {
    let ebml = element_at(bytes, 0)?;
    if ebml.id != ID_EBML {
        return Err(Stop::Invalid("missing EBML header"));
    }
    let segment = element_at(
        bytes,
        ebml.data_start + ebml.size.ok_or(Stop::Invalid("EBML size"))?,
    )?;
    if segment.id != ID_SEGMENT {
        return Err(Stop::Invalid("missing Segment"));
    }
    let base = segment.data_start;
    let segment_end = segment.size.map(|size| base + size);

    let mut seeks: Vec<(u64, u64)> = Vec::new();
    let mut found: Vec<(u64, Vec<u8>)> = Vec::new();
    let wanted = [ID_INFO, ID_TRACKS, ID_CUES];
    let has_all = |seeks: &[(u64, u64)], found: &[(u64, Vec<u8>)]| {
        wanted.iter().all(|id| {
            found.iter().any(|(found_id, _)| found_id == id)
                || seeks.iter().any(|(seek_id, _)| seek_id == id)
        })
    };

    // Walk the top level until the first Cluster, or until the SeekHead points at everything.
    let mut offset = base;
    for _ in 0..MAX_TOP_LEVEL_ELEMENTS {
        if segment_end.is_some_and(|end| offset >= end)
            || bytes.size.is_some_and(|size| offset >= size)
        {
            break;
        }
        let element = element_at(bytes, offset)?;
        if element.id == ID_CLUSTER {
            break;
        }
        if element.id == ID_SEEK_HEAD {
            seeks.extend(seek_entries(element_data(bytes, &element)?));
        } else if wanted.contains(&element.id) {
            found.push((element.id, element_data(bytes, &element)?.to_vec()));
        }
        if has_all(&seeks, &found) {
            break;
        }
        let Some(size) = element.size else { break };
        offset = element.data_start + size;
    }

    // A SeekHead may point at a second SeekHead near the end of the file.
    for (_, position) in seeks.clone().iter().filter(|(id, _)| *id == ID_SEEK_HEAD) {
        let element = element_at(bytes, base + position)?;
        if element.id == ID_SEEK_HEAD {
            seeks.extend(seek_entries(element_data(bytes, &element)?));
        }
    }
    for id in wanted {
        if found.iter().any(|(found_id, _)| *found_id == id) {
            continue;
        }
        let Some((_, position)) = seeks.iter().find(|(seek_id, _)| *seek_id == id) else {
            continue;
        };
        let element = element_at(bytes, base + position)?;
        if element.id == id {
            found.push((id, element_data(bytes, &element)?.to_vec()));
        }
    }
    let data = |id: u64| {
        found
            .iter()
            .find(|(found_id, _)| *found_id == id)
            .map(|(_, data)| data.as_slice())
    };

    let timestamp_scale = data(ID_INFO)
        .and_then(|info| child_uint(info, ID_TIMESTAMP_SCALE))
        .unwrap_or(1_000_000);
    let tracks: Vec<(u64, bool)> = data(ID_TRACKS)
        .map(|tracks| {
            children(tracks)
                .filter(|(id, _)| *id == ID_TRACK_ENTRY)
                .filter(|(_, entry)| child_uint(entry, ID_TRACK_TYPE) == Some(TRACK_TYPE_SUBTITLE))
                .filter_map(|(_, entry)| {
                    let number = child_uint(entry, ID_TRACK_NUMBER)?;
                    let text = children(entry)
                        .find(|(id, _)| *id == ID_CODEC_ID)
                        .is_some_and(|(_, codec)| codec.starts_with(b"S_TEXT"));
                    Some((number, text))
                })
                .collect()
        })
        .unwrap_or_default();
    let Some(cues) = data(ID_CUES) else {
        return Ok(Vec::new());
    };

    let mut timelines: Vec<(u64, bool, Vec<i64>)> = tracks
        .iter()
        .map(|&(number, text)| (number, text, Vec::new()))
        .collect();
    for (_, point) in children(cues).filter(|(id, _)| *id == ID_CUE_POINT) {
        let Some(time) = child_uint(point, ID_CUE_TIME) else {
            continue;
        };
        let millis = (u128::from(time) * u128::from(timestamp_scale) / 1_000_000) as i64;
        for (_, positions) in children(point).filter(|(id, _)| *id == ID_CUE_TRACK_POSITIONS) {
            let track = child_uint(positions, ID_CUE_TRACK);
            if let Some(timeline) = timelines
                .iter_mut()
                .find(|(number, ..)| Some(*number) == track)
            {
                timeline.2.push(millis);
            }
        }
    }
    // Text tracks mark each line once; image tracks also index the frames that clear them.
    Ok(timelines
        .into_iter()
        .filter(|(_, _, starts)| starts.len() >= MIN_CUES)
        .max_by_key(|(_, text, starts)| (*text, starts.len()))
        .map(|(_, _, starts)| sorted_unique(&starts))
        .unwrap_or_default())
}

fn element_at(bytes: &Bytes, offset: u64) -> Result<Element, Stop> {
    let head = bytes.read_up_to(offset, 12)?;
    let (id, id_length) = vint(head, true).ok_or(Stop::Invalid("element ID"))?;
    let (size, size_length) =
        vint(&head[id_length..], false).ok_or(Stop::Invalid("element size"))?;
    let unknown = size == (1u64 << (7 * size_length)) - 1;
    Ok(Element {
        id,
        data_start: offset + (id_length + size_length) as u64,
        size: (!unknown).then_some(size),
    })
}

fn element_data<'a>(bytes: &'a Bytes, element: &Element) -> Result<&'a [u8], Stop> {
    let size = element.size.ok_or(Stop::Invalid("element without size"))?;
    if size > MAX_ELEMENT_BYTES {
        return Err(Stop::Invalid("element too large"));
    }
    bytes.read(element.data_start, size)
}

fn seek_entries(seek_head: &[u8]) -> Vec<(u64, u64)> {
    children(seek_head)
        .filter(|(id, _)| *id == ID_SEEK)
        .filter_map(|(_, seek)| {
            let id = children(seek).find(|(id, _)| *id == ID_SEEK_ID)?.1;
            let position = child_uint(seek, ID_SEEK_POSITION)?;
            Some((uint(id)?, position))
        })
        .collect()
}

/// Reads a variable-length EBML integer. IDs keep their length marker; sizes do not.
fn vint(buffer: &[u8], keep_marker: bool) -> Option<(u64, usize)> {
    let first = *buffer.first()?;
    let length = first.leading_zeros() as usize + 1;
    if length > 8 || buffer.len() < length {
        return None;
    }
    let mut value = if keep_marker {
        u64::from(first)
    } else {
        u64::from(first) & (0xFF >> length)
    };
    for byte in &buffer[1..length] {
        value = (value << 8) | u64::from(*byte);
    }
    Some((value, length))
}

fn children(data: &[u8]) -> impl Iterator<Item = (u64, &[u8])> {
    let mut offset = 0;
    std::iter::from_fn(move || {
        let (id, id_length) = vint(data.get(offset..)?, true)?;
        let (size, size_length) = vint(data.get(offset + id_length..)?, false)?;
        let start = offset + id_length + size_length;
        let end = start.checked_add(usize::try_from(size).ok()?)?;
        let child = data.get(start..end)?;
        offset = end;
        Some((id, child))
    })
}

fn child_uint(data: &[u8], wanted: u64) -> Option<u64> {
    children(data)
        .find(|(id, _)| *id == wanted)
        .and_then(|(_, value)| uint(value))
}

fn uint(bytes: &[u8]) -> Option<u64> {
    (bytes.len() <= 8).then(|| {
        bytes
            .iter()
            .fold(0, |value, byte| (value << 8) | u64::from(*byte))
    })
}

fn is_mp4_box(kind: &[u8]) -> bool {
    [b"ftyp", b"moov", b"free", b"skip", b"wide", b"mdat"]
        .iter()
        .any(|known| kind == *known)
}

/// Reads sample times of MP4 subtitle tracks (tx3g, WebVTT, TTML) from the
/// `moov` box, which may sit before or after the media data.
fn mp4_timeline(bytes: &Bytes) -> Result<Vec<i64>, Stop> {
    let mut offset = 0;
    for _ in 0..MAX_TOP_LEVEL_ELEMENTS {
        let head = bytes.read_up_to(offset, 16)?;
        if head.len() < 8 {
            break;
        }
        let (size, header) = match be_u32(&head[..4]) {
            1 if head.len() >= 16 => (be_u64(&head[8..16]), 16),
            0 => (bytes.size.ok_or(Stop::Invalid("box size"))? - offset, 8),
            size => (u64::from(size), 8),
        };
        if size < header {
            return Err(Stop::Invalid("box size"));
        }
        if &head[4..8] == b"moov" {
            if size > MAX_ELEMENT_BYTES {
                return Err(Stop::Invalid("moov too large"));
            }
            return Ok(moov_timeline(bytes.read(offset + header, size - header)?));
        }
        offset += size;
    }
    Ok(Vec::new())
}

fn moov_timeline(moov: &[u8]) -> Vec<i64> {
    boxes(moov)
        .filter(|(kind, _)| kind == b"trak")
        .filter_map(|(_, trak)| {
            let mdia = child_box(trak, b"mdia")?;
            let handler = child_box(mdia, b"hdlr")?.get(8..12)?;
            if ![b"sbtl", b"text", b"subt"]
                .iter()
                .any(|kind| handler == *kind)
            {
                return None;
            }
            let mdhd = child_box(mdia, b"mdhd")?;
            let timescale = if *mdhd.first()? == 1 {
                be_u32(mdhd.get(20..24)?)
            } else {
                be_u32(mdhd.get(12..16)?)
            };
            let stbl = child_box(child_box(mdia, b"minf")?, b"stbl")?;
            sample_starts(stbl, u64::from(timescale).max(1))
        })
        .max_by_key(Vec::len)
        .unwrap_or_default()
}

/// Start times of non-empty samples. tx3g writes gaps between lines as empty samples.
fn sample_starts(stbl: &[u8], timescale: u64) -> Option<Vec<i64>> {
    let stts = child_box(stbl, b"stts")?;
    let stsz = child_box(stbl, b"stsz")?;
    let uniform_size = be_u32(stsz.get(4..8)?);
    let sample_size = |index: usize| -> Option<u32> {
        if uniform_size != 0 {
            Some(uniform_size)
        } else {
            stsz.get(12 + index * 4..16 + index * 4).map(be_u32)
        }
    };
    let mut starts = Vec::new();
    let mut time = 0u64;
    let mut index = 0usize;
    for entry in 0..be_u32(stts.get(4..8)?) as usize {
        let at = 8 + entry * 8;
        let count = be_u32(stts.get(at..at + 4)?);
        let delta = u64::from(be_u32(stts.get(at + 4..at + 8)?));
        for _ in 0..count {
            if sample_size(index)? > 2 {
                starts.push((u128::from(time) * 1_000 / u128::from(timescale)) as i64);
            }
            time += delta;
            index += 1;
            if index > 200_000 {
                return None;
            }
        }
    }
    Some(starts)
}

fn boxes(data: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    let mut offset = 0usize;
    std::iter::from_fn(move || {
        let head = data.get(offset..offset + 8)?;
        let kind: [u8; 4] = head[4..8].try_into().ok()?;
        let (size, header) = match be_u32(&head[..4]) {
            1 => (
                usize::try_from(be_u64(data.get(offset + 8..offset + 16)?)).ok()?,
                16,
            ),
            0 => (data.len() - offset, 8),
            size => (size as usize, 8),
        };
        let payload = data.get(offset + header..offset.checked_add(size)?)?;
        offset += size;
        Some((kind, payload))
    })
}

fn child_box<'a>(data: &'a [u8], kind: &[u8; 4]) -> Option<&'a [u8]> {
    boxes(data)
        .find(|(found, _)| found == kind)
        .map(|(_, payload)| payload)
}

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes(bytes[..4].try_into().expect("four bytes"))
}

fn be_u64(bytes: &[u8]) -> u64 {
    u64::from_be_bytes(bytes[..8].try_into().expect("eight bytes"))
}

fn decode_base64(value: &str) -> Result<Vec<u8>, TimelineError> {
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0;
    for byte in value.bytes() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' => continue,
            _ => return Err(TimelineError::InvalidRange),
        };
        buffer = (buffer << 6) | u32::from(digit);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_base64(bytes: &[u8]) -> String {
        const DIGITS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        bytes
            .chunks(3)
            .flat_map(|chunk| {
                let value = chunk.iter().enumerate().fold(0u32, |value, (index, byte)| {
                    value | u32::from(*byte) << (16 - 8 * index)
                });
                (0..4).map(move |index| {
                    if index <= chunk.len() {
                        DIGITS[(value >> (18 - 6 * index) & 63) as usize] as char
                    } else {
                        '='
                    }
                })
            })
            .collect()
    }

    /// Feeds the timeline every range it asks for, like a player would.
    fn read_timeline(file: &[u8]) -> Result<Vec<i64>, TimelineError> {
        let mut ranges = Vec::new();
        for _ in 0..16 {
            match subtitle_timeline(&ranges, Some(file.len() as u64))? {
                TimelineStep::Timeline { starts } => return Ok(starts),
                TimelineStep::Need { offset, length } => ranges.push(ByteRange {
                    offset,
                    data: encode_base64(&file[offset as usize..(offset + length) as usize]),
                }),
            }
        }
        panic!("timeline did not finish");
    }

    fn ebml(id: u64, data: &[u8]) -> Vec<u8> {
        let mut out = id
            .to_be_bytes()
            .iter()
            .skip_while(|byte| **byte == 0)
            .copied()
            .collect::<Vec<_>>();
        out.push(0x01);
        out.extend((data.len() as u64).to_be_bytes().iter().skip(1));
        out.extend(data);
        out
    }

    fn ebml_uint(id: u64, value: u64) -> Vec<u8> {
        ebml(id, &value.to_be_bytes())
    }

    /// Irregular gaps like real dialogue, so no shifted copy lines up by accident.
    fn sample_starts_ms() -> Vec<i64> {
        let mut seed = 7u64;
        let mut start = 5_000;
        (0..40)
            .map(|_| {
                seed = seed
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695)
                    >> 1;
                start += 1_500 + (seed % 4_500) as i64;
                start
            })
            .collect()
    }

    /// A Matroska file with a large attachment before Cues, so reads must follow the SeekHead.
    fn matroska_file() -> Vec<u8> {
        let tracks = ebml(
            ID_TRACKS,
            &[
                ebml(
                    ID_TRACK_ENTRY,
                    &[ebml_uint(ID_TRACK_NUMBER, 1), ebml_uint(ID_TRACK_TYPE, 1)].concat(),
                ),
                ebml(
                    ID_TRACK_ENTRY,
                    &[
                        ebml_uint(ID_TRACK_NUMBER, 3),
                        ebml_uint(ID_TRACK_TYPE, 0x11),
                        ebml(ID_CODEC_ID, b"S_TEXT/UTF8"),
                    ]
                    .concat(),
                ),
            ]
            .concat(),
        );
        let points: Vec<u8> = sample_starts_ms()
            .iter()
            .flat_map(|millis| {
                ebml(
                    ID_CUE_POINT,
                    &[
                        ebml_uint(ID_CUE_TIME, *millis as u64),
                        ebml(ID_CUE_TRACK_POSITIONS, &ebml_uint(ID_CUE_TRACK, 3)),
                    ]
                    .concat(),
                )
            })
            .collect();
        let cues = ebml(ID_CUES, &points);
        let filler = ebml(0xEC, &vec![0; 600_000]);
        let info = ebml(ID_INFO, &ebml_uint(ID_TIMESTAMP_SCALE, 1_000_000));
        let seek = |id: u64, position: u64| {
            ebml(
                ID_SEEK,
                &[
                    ebml(ID_SEEK_ID, &(id as u32).to_be_bytes()),
                    ebml_uint(ID_SEEK_POSITION, position),
                ]
                .concat(),
            )
        };
        // The SeekHead has a fixed encoded size, so positions can be computed up front.
        let seek_head_size = ebml(
            ID_SEEK_HEAD,
            &[seek(ID_INFO, 0), seek(ID_TRACKS, 0), seek(ID_CUES, 0)].concat(),
        )
        .len() as u64;
        let info_at = seek_head_size;
        let tracks_at = info_at + info.len() as u64;
        let cues_at = tracks_at + tracks.len() as u64 + filler.len() as u64;
        let seek_head = ebml(
            ID_SEEK_HEAD,
            &[
                seek(ID_INFO, info_at),
                seek(ID_TRACKS, tracks_at),
                seek(ID_CUES, cues_at),
            ]
            .concat(),
        );
        let segment = [seek_head, info, tracks, filler, cues].concat();
        [
            ebml(ID_EBML, &ebml_uint(0x4282, 0)),
            ebml(ID_SEGMENT, &segment),
        ]
        .concat()
    }

    fn mp4_box(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        [&(payload.len() as u32 + 8).to_be_bytes()[..], kind, payload].concat()
    }

    /// An MP4 with `moov` after `mdat` and empty tx3g samples between lines.
    fn mp4_file() -> Vec<u8> {
        let starts = sample_starts_ms();
        let mut stts = vec![0u8; 4];
        let mut sizes = Vec::new();
        let mut entries = Vec::new();
        let mut time = 0;
        for start in &starts {
            entries.push(((start - time) as u32, 2u32));
            entries.push((300, 20));
            time = start + 300;
        }
        stts.extend((entries.len() as u32).to_be_bytes());
        for (delta, size) in &entries {
            stts.extend(1u32.to_be_bytes());
            stts.extend(delta.to_be_bytes());
            sizes.extend(size.to_be_bytes());
        }
        let stsz = [
            &[0u8; 4][..],
            &0u32.to_be_bytes(),
            &(entries.len() as u32).to_be_bytes(),
            &sizes,
        ]
        .concat();
        let stbl = mp4_box(
            b"stbl",
            &[mp4_box(b"stts", &stts), mp4_box(b"stsz", &stsz)].concat(),
        );
        let mdhd = [&[0u8; 12][..], &1_000u32.to_be_bytes(), &[0u8; 8]].concat();
        let hdlr = [&[0u8; 8][..], b"sbtl", &[0u8; 12]].concat();
        let mdia = mp4_box(
            b"mdia",
            &[
                mp4_box(b"mdhd", &mdhd),
                mp4_box(b"hdlr", &hdlr),
                mp4_box(b"minf", &stbl),
            ]
            .concat(),
        );
        let moov = mp4_box(b"moov", &mp4_box(b"trak", &mdia));
        [
            mp4_box(b"ftyp", b"isom"),
            mp4_box(b"mdat", &vec![0; 700_000]),
            moov,
        ]
        .concat()
    }

    #[test]
    fn reads_subtitle_cues_from_matroska() {
        assert_eq!(read_timeline(&matroska_file()), Ok(sample_starts_ms()));
    }

    #[test]
    fn reads_subtitle_samples_from_mp4() {
        assert_eq!(read_timeline(&mp4_file()), Ok(sample_starts_ms()));
    }

    #[test]
    fn rejects_streams_it_cannot_index() {
        let playlist = b"#EXTM3U\n#EXT-X-VERSION:3\n".repeat(10);
        assert_eq!(
            read_timeline(&playlist),
            Err(TimelineError::UnsupportedContainer)
        );
        let mut no_cues = matroska_file();
        no_cues.truncate(no_cues.len() - 1);
        assert!(read_timeline(&no_cues).is_err());
    }

    #[test]
    fn parses_subtitle_formats() {
        let srt = "1\n00:00:01,500 --> 00:00:03,000\nHi\n\n2\n00:01:02,250 --> 00:01:04,000\nThere";
        let vtt = "WEBVTT\n\n00:01.500 --> 00:03.000 align:start\nHi";
        let ass = "[Events]\nDialogue: 0,0:01:02.25,0:01:04.00,Default,,0,0,0,,There";
        assert_eq!(subtitle_starts(srt), vec![1_500, 62_250]);
        assert_eq!(subtitle_starts(vtt), vec![1_500]);
        assert_eq!(subtitle_starts(ass), vec![62_250]);
    }

    #[test]
    fn finds_the_delay_between_matching_tracks() {
        let reference = sample_starts_ms();
        // The add-on shows lines 1.27 s early, drops some, and adds a few of its own.
        let subtitle: Vec<i64> = reference
            .iter()
            .enumerate()
            .filter(|(index, _)| index % 5 != 0)
            .map(|(_, start)| start - 1_270)
            .chain([7_777, 33_333, 90_001])
            .collect();
        let alignment = align_subtitle(&reference, &subtitle).expect("confident match");
        assert_eq!(alignment.delay_ms, 1_270);
        assert!(alignment.matched >= 32);
    }

    #[test]
    fn declines_unrelated_tracks() {
        let reference = sample_starts_ms();
        let unrelated: Vec<i64> = (0..40)
            .map(|index| 4_000 + index * index * 97 % 140_000)
            .collect();
        assert_eq!(align_subtitle(&reference, &unrelated), None);
        assert_eq!(align_subtitle(&reference, &reference[..10]), None);
    }
}
