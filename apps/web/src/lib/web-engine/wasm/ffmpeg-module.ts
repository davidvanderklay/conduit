/** The exports of `ffmpeg-audio.mjs` and `ffmpeg-video.mjs`, built from `apps/web/wasm/ffmpeg_bridge.c`. */
export interface FFmpegModule {
  // No pthreads, so memory is never shared.
  HEAPU8: Uint8Array<ArrayBuffer>
  _malloc(size: number): number
  _free(pointer: number): void
  stringToNewUTF8(value: string): number
  _decoder_open(name: number, extradata: number, extradataSize: number): number
  _decoder_packet(decoder: number, size: number): number
  _decoder_send(decoder: number, timestamp: number, duration: number): number
  _decoder_drain(decoder: number): number
  _decoder_receive(decoder: number): number
  _decoder_reset(decoder: number): void
  _decoder_close(decoder: number): void
  _frame_pixel_layout(decoder: number): number
  _frame_sample_layout(decoder: number): number
  _frame_data(decoder: number, plane: number): number
  _frame_linesize(decoder: number, plane: number): number
  _frame_timestamp(decoder: number): number
  _frame_duration(decoder: number): number
  _frame_width(decoder: number): number
  _frame_height(decoder: number): number
  _frame_color_primaries(decoder: number): number
  _frame_color_transfer(decoder: number): number
  _frame_color_matrix(decoder: number): number
  _frame_full_range(decoder: number): number
  _frame_samples(decoder: number): number
  _frame_sample_rate(decoder: number): number
  _frame_channels(decoder: number): number
  _frame_channel_mask(decoder: number): number
  /** Pointer to the frame's Dolby Vision metadata, or 0 when it has none. */
  _frame_dovi(decoder: number): number
  /** Parses a Dolby Vision RPU NAL unit; returns a metadata pointer, or 0 when it does not parse. */
  _rpu_parse(nal: number, size: number): number
}

export type FFmpegModuleFactory = (options?: {
  locateFile?: (path: string) => string
}) => Promise<FFmpegModule>
