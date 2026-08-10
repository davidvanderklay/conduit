export function browserPlaybackError(code?: number): string {
  switch (code) {
    case 1:
      return "Playback was interrupted. Try the stream again."
    case 2:
      return "The browser could not fetch this stream. The media host may be offline or may block browser access."
    case 3:
      return "The browser could not decode this stream's container or codecs. Try another stream or use the conduit desktop app, which supports more media formats."
    case 4:
      return "This stream is not supported by the browser. Try another stream or use the conduit desktop app, which supports more media formats."
    default:
      return "The browser could not play this stream. Try another stream or use the conduit desktop app."
  }
}
