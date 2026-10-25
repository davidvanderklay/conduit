/*
 * A small libavcodec decoding API for the web player's WebAssembly decoders.
 *
 * JavaScript opens a decoder for one codec, writes each packet into memory the
 * bridge allocates, and reads decoded frames back through the getters. The same
 * file builds the audio module (DTS, TrueHD, MLP) and the video module (HEVC).
 * Adapted from the decoder bridges of WebGPU Player (MIT):
 * https://github.com/alchemyyy/WebGPU-Player
 */

#include "config.h"

#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "libavcodec/avcodec.h"
#include "libavutil/channel_layout.h"
#include "libavutil/dovi_meta.h"
#include "libavutil/error.h"
#include "libavutil/hdr_dynamic_metadata.h"
#include "libavutil/mastering_display_metadata.h"
#include "libavutil/log.h"
#include "libavutil/mem.h"
#include "libavutil/pixdesc.h"
#include "libavutil/samplefmt.h"
#if CONFIG_DOVI_RPUDEC
#include "libavcodec/dovi_rpu.h"
#endif

#define MAXIMUM_EXTRADATA_SIZE (1024 * 1024)

typedef struct Decoder {
    AVCodecContext *context;
    AVPacket *packet;
    AVFrame *frame;
} Decoder;

static void free_decoder(Decoder *decoder) {
    if (!decoder) return;
    av_frame_free(&decoder->frame);
    av_packet_free(&decoder->packet);
    avcodec_free_context(&decoder->context);
    free(decoder);
}

/* Opens a decoder by FFmpeg name ("hevc", "dca", "truehd", "mlp"). Extradata may be empty. */
EMSCRIPTEN_KEEPALIVE
Decoder *decoder_open(const char *name, const uint8_t *extradata, int extradata_size) {
    if (extradata_size < 0 || extradata_size > MAXIMUM_EXTRADATA_SIZE) return NULL;
    const AVCodec *codec = avcodec_find_decoder_by_name(name);
    if (!codec) return NULL;
    av_log_set_level(AV_LOG_QUIET);

    Decoder *decoder = calloc(1, sizeof(Decoder));
    if (!decoder) return NULL;
    decoder->context = avcodec_alloc_context3(codec);
    decoder->packet = av_packet_alloc();
    decoder->frame = av_frame_alloc();
    if (!decoder->context || !decoder->packet || !decoder->frame) {
        free_decoder(decoder);
        return NULL;
    }

    decoder->context->pkt_timebase = (AVRational) { 1, 1000000 };
    decoder->context->thread_count = 1;
    // Crops to the conformance window exactly, even where the cropped planes start unaligned.
    decoder->context->flags |= AV_CODEC_FLAG_UNALIGNED;
    if (extradata_size > 0) {
        decoder->context->extradata = av_mallocz(extradata_size + AV_INPUT_BUFFER_PADDING_SIZE);
        if (!decoder->context->extradata) {
            free_decoder(decoder);
            return NULL;
        }
        memcpy(decoder->context->extradata, extradata, extradata_size);
        decoder->context->extradata_size = extradata_size;
    }

    if (avcodec_open2(decoder->context, codec, NULL) < 0) {
        free_decoder(decoder);
        return NULL;
    }
    return decoder;
}

/* Allocates the next packet and returns its data for JavaScript to fill. */
EMSCRIPTEN_KEEPALIVE
uint8_t *decoder_packet(Decoder *decoder, int size) {
    if (!decoder || size <= 0) return NULL;
    av_packet_unref(decoder->packet);
    if (av_new_packet(decoder->packet, size) < 0) return NULL;
    return decoder->packet->data;
}

/* Sends the filled packet. Timestamps are microseconds and come back on the frames they code. */
EMSCRIPTEN_KEEPALIVE
int decoder_send(Decoder *decoder, double timestamp, double duration) {
    if (!decoder) return AVERROR(EINVAL);
    decoder->packet->pts = (int64_t) timestamp;
    decoder->packet->dts = AV_NOPTS_VALUE;
    decoder->packet->duration = (int64_t) duration;
    int result = avcodec_send_packet(decoder->context, decoder->packet);
    av_packet_unref(decoder->packet);
    // A damaged packet only loses its own output.
    return result == AVERROR_INVALIDDATA ? 0 : result;
}

/* Signals the end of the stream so held frames come out. */
EMSCRIPTEN_KEEPALIVE
int decoder_drain(Decoder *decoder) {
    if (!decoder) return AVERROR(EINVAL);
    int result = avcodec_send_packet(decoder->context, NULL);
    return result == AVERROR_EOF ? 0 : result;
}

/* Returns 1 with a frame ready, 0 when the decoder needs more input, or a negative error. */
EMSCRIPTEN_KEEPALIVE
int decoder_receive(Decoder *decoder) {
    if (!decoder) return AVERROR(EINVAL);
    av_frame_unref(decoder->frame);
    int result = avcodec_receive_frame(decoder->context, decoder->frame);
    if (result == 0) return 1;
    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF || result == AVERROR_INVALIDDATA) return 0;
    return result;
}

/* Drops held frames, for seeking. */
EMSCRIPTEN_KEEPALIVE
void decoder_reset(Decoder *decoder) {
    if (!decoder) return;
    av_frame_unref(decoder->frame);
    avcodec_flush_buffers(decoder->context);
}

EMSCRIPTEN_KEEPALIVE
void decoder_close(Decoder *decoder) {
    free_decoder(decoder);
}

/*
 * Describes a video frame's layout as bit depth << 8 | horizontal chroma shift << 4 | vertical
 * chroma shift, or 0 unless it is three-plane YUV, the only layout the player reads.
 */
EMSCRIPTEN_KEEPALIVE
int frame_pixel_layout(Decoder *decoder) {
    const AVPixFmtDescriptor *descriptor = av_pix_fmt_desc_get(decoder->frame->format);
    if (!descriptor || descriptor->nb_components != 3 || !(descriptor->flags & AV_PIX_FMT_FLAG_PLANAR)
        || (descriptor->flags & (AV_PIX_FMT_FLAG_RGB | AV_PIX_FMT_FLAG_BE))) {
        return 0;
    }
    return descriptor->comp[0].depth << 8 | descriptor->log2_chroma_w << 4 | descriptor->log2_chroma_h;
}

/* Describes an audio frame's samples as planar << 8 | packed AVSampleFormat (U8, S16, S32, FLT, DBL). */
EMSCRIPTEN_KEEPALIVE
int frame_sample_layout(Decoder *decoder) {
    enum AVSampleFormat format = decoder->frame->format;
    return av_sample_fmt_is_planar(format) << 8 | av_get_packed_sample_fmt(format);
}

/* A video plane, or an audio channel's plane for planar samples (plane 0 holds packed samples). */
EMSCRIPTEN_KEEPALIVE
uint8_t *frame_data(Decoder *decoder, int plane) {
    int planes = decoder->frame->nb_samples ? decoder->frame->ch_layout.nb_channels : AV_NUM_DATA_POINTERS;
    return plane >= 0 && plane < planes ? decoder->frame->extended_data[plane] : NULL;
}

EMSCRIPTEN_KEEPALIVE
int frame_linesize(Decoder *decoder, int plane) {
    return plane >= 0 && plane < AV_NUM_DATA_POINTERS ? decoder->frame->linesize[plane] : 0;
}

EMSCRIPTEN_KEEPALIVE
double frame_timestamp(Decoder *decoder) {
    int64_t pts = decoder->frame->best_effort_timestamp;
    return pts == AV_NOPTS_VALUE ? -1 : (double) pts;
}

EMSCRIPTEN_KEEPALIVE
double frame_duration(Decoder *decoder) { return (double) decoder->frame->duration; }

EMSCRIPTEN_KEEPALIVE
int frame_width(Decoder *decoder) { return decoder->frame->width; }

EMSCRIPTEN_KEEPALIVE
int frame_height(Decoder *decoder) { return decoder->frame->height; }

/* H.273 code points, which JavaScript maps to WebCodecs color spaces. */
EMSCRIPTEN_KEEPALIVE
int frame_color_primaries(Decoder *decoder) { return decoder->frame->color_primaries; }

EMSCRIPTEN_KEEPALIVE
int frame_color_transfer(Decoder *decoder) { return decoder->frame->color_trc; }

EMSCRIPTEN_KEEPALIVE
int frame_color_matrix(Decoder *decoder) { return decoder->frame->colorspace; }

EMSCRIPTEN_KEEPALIVE
int frame_full_range(Decoder *decoder) { return decoder->frame->color_range == AVCOL_RANGE_JPEG; }

EMSCRIPTEN_KEEPALIVE
int frame_samples(Decoder *decoder) { return decoder->frame->nb_samples; }

EMSCRIPTEN_KEEPALIVE
int frame_sample_rate(Decoder *decoder) { return decoder->frame->sample_rate; }

EMSCRIPTEN_KEEPALIVE
int frame_channels(Decoder *decoder) { return decoder->frame->ch_layout.nb_channels; }

/* Bitmask of WAVE speaker positions in the planes' order, or 0 when the layout is not a mask. */
EMSCRIPTEN_KEEPALIVE
double frame_channel_mask(Decoder *decoder) {
    const AVChannelLayout *layout = &decoder->frame->ch_layout;
    return layout->order == AV_CHANNEL_ORDER_NATIVE ? (double) layout->u.mask : 0;
}

/*
 * Dolby Vision metadata layout shared with dolby-vision.ts, all floats:
 *   0      base layer bit depth
 *   1      source_max_pq / 4095
 *   2      level 1 max_pq / 4095, or -1 without a level 1 block
 *   4..6   YCbCr offsets, rescaled from 2^bits to the (2^bits - 1) code range
 *   8..16  YCbCr to nonlinear RGB matrix, row-major, applied before PQ linearization
 *   17..25 linear signal to BT.2020 RGB: the BT.2020 HPE LMS to RGB matrix times the RPU's RGB to LMS
 *   32...  per component: pivot count, 9 normalized pivots, then 8 pieces of 27 floats:
 *          method (0 polynomial, 1 MMR), 3 polynomial coefficients, MMR order, MMR constant,
 *          3 orders x 7 MMR coefficients
 */
#define DOVI_HEADER 32
#define DOVI_PIECE_STRIDE 27
#define DOVI_COMPONENT_STRIDE (1 + 9 + AV_DOVI_MAX_PIECES * DOVI_PIECE_STRIDE)
#define DOVI_SIZE (DOVI_HEADER + 3 * DOVI_COMPONENT_STRIDE)

static float dovi_params[DOVI_SIZE];

// Inverse of the BT.2020 to HPE LMS matrix Dolby Vision outputs, as libplacebo hard-codes it.
static const double DOVI_LMS_TO_RGB[9] = {
    3.06441879, -2.16597676, 0.10155818,
    -0.65612108, 1.78554118, -0.12943749,
    0.01736321, -0.04725154, 1.03004253,
};

static float *fill_dovi(const AVDOVIMetadata *dovi) {
    const AVDOVIRpuDataHeader *header = av_dovi_get_header(dovi);
    const AVDOVIDataMapping *mapping = av_dovi_get_mapping(dovi);
    const AVDOVIColorMetadata *color = av_dovi_get_color(dovi);
    const double code_max = (double) ((1 << header->bl_bit_depth) - 1);
    const double coefficient_scale = 1.0 / (double) (1LL << header->coef_log2_denom);
    float *out = dovi_params;
    memset(out, 0, sizeof(dovi_params));

    out[0] = header->bl_bit_depth;
    out[1] = color->source_max_pq / 4095.0f;
    out[2] = -1;
    for (int i = 0; i < dovi->num_ext_blocks; i++) {
        const AVDOVIDmData *block = av_dovi_get_ext(dovi, i);
        if (block->level == 1) out[2] = block->l1.max_pq / 4095.0f;
    }
    for (int i = 0; i < 3; i++) {
        out[4 + i] = av_q2d(color->ycc_to_rgb_offset[i]) * (code_max + 1) / code_max;
    }
    for (int i = 0; i < 9; i++) out[8 + i] = av_q2d(color->ycc_to_rgb_matrix[i]);
    for (int row = 0; row < 3; row++) {
        for (int column = 0; column < 3; column++) {
            double sum = 0;
            for (int k = 0; k < 3; k++) {
                sum += DOVI_LMS_TO_RGB[row * 3 + k] * av_q2d(color->rgb_to_lms_matrix[k * 3 + column]);
            }
            out[17 + row * 3 + column] = sum;
        }
    }

    for (int component = 0; component < 3; component++) {
        const AVDOVIReshapingCurve *curve = &mapping->curves[component];
        float *base = out + DOVI_HEADER + component * DOVI_COMPONENT_STRIDE;
        base[0] = curve->num_pivots;
        for (int i = 0; i < curve->num_pivots && i < AV_DOVI_MAX_PIECES + 1; i++) {
            base[1 + i] = curve->pivots[i] / code_max;
        }
        for (int i = 0; i + 1 < curve->num_pivots && i < AV_DOVI_MAX_PIECES; i++) {
            float *piece = base + 10 + i * DOVI_PIECE_STRIDE;
            piece[0] = curve->mapping_idc[i] == AV_DOVI_MAPPING_MMR;
            if (curve->mapping_idc[i] == AV_DOVI_MAPPING_POLYNOMIAL) {
                for (int k = 0; k <= curve->poly_order[i] && k < 3; k++) {
                    piece[1 + k] = curve->poly_coef[i][k] * coefficient_scale;
                }
            } else {
                piece[4] = curve->mmr_order[i];
                piece[5] = curve->mmr_constant[i] * coefficient_scale;
                for (int order = 0; order < curve->mmr_order[i] && order < 3; order++) {
                    for (int k = 0; k < 7; k++) {
                        piece[6 + order * 7 + k] = curve->mmr_coef[i][order][k] * coefficient_scale;
                    }
                }
            }
        }
    }
    return out;
}

/* Returns the frame's Dolby Vision metadata in the layout above, or NULL when it has none. */
EMSCRIPTEN_KEEPALIVE
float *frame_dovi(Decoder *decoder) {
    const AVFrameSideData *side_data =
        av_frame_get_side_data(decoder->frame, AV_FRAME_DATA_DOVI_METADATA);
    return side_data ? fill_dovi((const AVDOVIMetadata *) side_data->data) : NULL;
}

#if CONFIG_DOVI_RPUDEC
// RPUs may refer back to earlier ones, so one context parses a stream's RPUs in decode order.
static DOVIContext rpu_context;
#endif

/*
 * Parses a Dolby Vision RPU NAL unit (type 62, with its 2-byte header and
 * emulation prevention) for streams a hardware decoder decodes, and returns
 * its metadata in the layout above, or NULL when it does not parse.
 */
EMSCRIPTEN_KEEPALIVE
float *rpu_parse(const uint8_t *nal, int size) {
#if CONFIG_DOVI_RPUDEC
    if (size <= 2) return NULL;
    uint8_t *rbsp = av_malloc(size);
    if (!rbsp) return NULL;
    int length = 0;
    for (int index = 2; index < size; index++) {
        if (nal[index] == 3 && index >= 4 && nal[index - 1] == 0 && nal[index - 2] == 0) continue;
        rbsp[length++] = nal[index];
    }
    AVDOVIMetadata *metadata = NULL;
    float *out = NULL;
    if (ff_dovi_rpu_parse(&rpu_context, rbsp, length, 0) >= 0
        && ff_dovi_get_metadata(&rpu_context, &metadata) > 0) {
        out = fill_dovi(metadata);
    }
    av_free(metadata);
    av_free(rbsp);
    return out;
#else
    (void) nal;
    (void) size;
    return NULL;
#endif
}

/*
 * HDR peak luminance in nits: HDR10+ scene peak, MaxCLL, and mastering display
 * peak, each 0 when absent. frame_hdr_peaks and sei_hdr_peaks fill it.
 */
static double hdr_peaks[3];

static double hdr10plus_peak(const AVDynamicHDRPlus *metadata) {
    if (metadata->num_windows < 1) return 0;
    double peak = 0;
    for (int component = 0; component < 3; component++) {
        double value = 10000 * av_q2d(metadata->params[0].maxscl[component]);
        if (value > peak) peak = value;
    }
    return peak;
}

/* Reads a software-decoded frame's HDR metadata into hdr_peaks. */
EMSCRIPTEN_KEEPALIVE
double *frame_hdr_peaks(Decoder *decoder) {
    const AVFrameSideData *dynamic = av_frame_get_side_data(decoder->frame, AV_FRAME_DATA_DYNAMIC_HDR_PLUS);
    const AVFrameSideData *light = av_frame_get_side_data(decoder->frame, AV_FRAME_DATA_CONTENT_LIGHT_LEVEL);
    const AVFrameSideData *mastering = av_frame_get_side_data(decoder->frame, AV_FRAME_DATA_MASTERING_DISPLAY_METADATA);
    hdr_peaks[0] = dynamic ? hdr10plus_peak((const AVDynamicHDRPlus *) dynamic->data) : 0;
    hdr_peaks[1] = light ? ((const AVContentLightMetadata *) light->data)->MaxCLL : 0;
    const AVMasteringDisplayMetadata *display = mastering ? (const AVMasteringDisplayMetadata *) mastering->data : NULL;
    hdr_peaks[2] = display && display->has_luminance ? av_q2d(display->max_luminance) : 0;
    return hdr_peaks;
}

/*
 * Reads the HDR metadata of an HEVC SEI NAL unit (type 39, with its 2-byte header
 * and emulation prevention) into hdr_peaks, for streams decoded in hardware.
 */
EMSCRIPTEN_KEEPALIVE
double *sei_hdr_peaks(const uint8_t *nal, int size) {
    hdr_peaks[0] = hdr_peaks[1] = hdr_peaks[2] = 0;
    uint8_t *rbsp = av_malloc(size > 2 ? size : 1);
    if (!rbsp) return hdr_peaks;
    int length = 0;
    for (int index = 2; index < size; index++) {
        if (nal[index] == 3 && index >= 4 && nal[index - 1] == 0 && nal[index - 2] == 0) continue;
        rbsp[length++] = nal[index];
    }
    int offset = 0;
    // Messages until the rbsp_trailing_bits byte.
    while (offset + 2 <= length && rbsp[offset] != 0x80) {
        int type = 0, payload = 0;
        while (offset < length && rbsp[offset] == 0xff) type += rbsp[offset++];
        if (offset >= length) break;
        type += rbsp[offset++];
        while (offset < length && rbsp[offset] == 0xff) payload += rbsp[offset++];
        if (offset >= length) break;
        payload += rbsp[offset++];
        if (offset + payload > length) break;
        const uint8_t *data = rbsp + offset;
        if (type == 137 && payload >= 24) {
            // Mastering display colour volume: primaries and white point, then max luminance in 0.0001 cd/m2.
            hdr_peaks[2] = ((uint32_t) data[16] << 24 | data[17] << 16 | data[18] << 8 | data[19]) / 10000.0;
        } else if (type == 144 && payload >= 4) {
            hdr_peaks[1] = data[0] << 8 | data[1];
        } else if (type == 4 && payload >= 7 && data[0] == 0xb5 && data[1] == 0x00 && data[2] == 0x3c
                   && data[3] == 0x00 && data[4] == 0x01 && data[5] == 0x04) {
            // ST 2094-40 (HDR10+): country 0xB5, provider 0x003C, oriented code 0x0001, application 4.
            AVDynamicHDRPlus metadata = { 0 };
            if (av_dynamic_hdr_plus_from_t35(&metadata, data + 6, payload - 6) >= 0) {
                hdr_peaks[0] = hdr10plus_peak(&metadata);
            }
        }
        offset += payload;
    }
    av_free(rbsp);
    return hdr_peaks;
}
