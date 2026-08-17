#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdint.h>

// MPVKit 0.39 was built against newer FFmpeg and libplacebo symbol spellings
// than the shared FFmpegKit 6.1.4 binaries expose. These small ABI shims keep
// the retained MPVKit fallback linkable without bringing back a second copy of
// FFmpeg into the app. Recheck them whenever either binary version changes.

typedef struct {
    int num;
    int den;
} ConduitAVRational;

char *av_ts_make_time_string2(
    char *buffer,
    int64_t timestamp,
    ConduitAVRational timebase
) {
    if (timestamp == INT64_MIN) {
        snprintf(buffer, 32, "NOPTS");
        return buffer;
    }

    double value = ((double) timebase.num / (double) timebase.den) * timestamp;
    double logarithm = fpclassify(value) == FP_ZERO
        ? -INFINITY
        : floor(log10(fabs(value)));
    int precision = isfinite(logarithm) && logarithm < 0
        ? (int) -logarithm + 5
        : 6;
    int last = snprintf(buffer, 32, "%.*f", precision, value);
    last = last < 0 ? 0 : (last < 32 ? last : 31) - 1;
    for (; last > 0 && buffer[last] == '0'; last--);
    for (; last > 0 && buffer[last] != 'f' &&
           (buffer[last] < '0' || buffer[last] > '9'); last--);
    buffer[last + 1] = '\0';
    return buffer;
}

typedef const struct ConduitPLLog *ConduitPLLog;
struct ConduitPLLogParams;

extern ConduitPLLog pl_log_create_338(
    int apiVersion,
    const struct ConduitPLLogParams *params
);

ConduitPLLog pl_log_create_349(
    int apiVersion,
    const struct ConduitPLLogParams *params
) {
    return pl_log_create_338(apiVersion, params);
}

typedef struct {
    size_t headerOffset;
    size_t mappingOffset;
    size_t colorOffset;
    size_t extensionBlockOffset;
    size_t extensionBlockSize;
    int extensionBlockCount;
} ConduitAVDOVIMetadata;

typedef struct {
    uint8_t level;
} ConduitAVDOVIDmData;

ConduitAVDOVIDmData *av_dovi_find_level(
    const ConduitAVDOVIMetadata *metadata,
    uint8_t level
) {
    if (metadata == NULL) {
        return NULL;
    }
    for (int index = 0; index < metadata->extensionBlockCount; index++) {
        ConduitAVDOVIDmData *extension = (ConduitAVDOVIDmData *)
            ((uint8_t *) metadata + metadata->extensionBlockOffset +
             metadata->extensionBlockSize * index);
        if (extension->level == level) {
            return extension;
        }
    }
    return NULL;
}
