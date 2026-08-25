#include <jni.h>
#include <mpv/client.h>

#include <algorithm>
#include <clocale>
#include <cstdint>
#include <cstdlib>
#include <mutex>
#include <string>
#include <unordered_set>
#include <vector>

namespace {

struct Player {
    mpv_handle *mpv = nullptr;
    std::mutex mutex;
};

std::mutex playersMutex;
std::unordered_set<Player *> players;

std::string utf8(JNIEnv *env, jstring value) {
    if (value == nullptr) return {};
    const char *chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

std::string headerFields(JNIEnv *env, jobjectArray values) {
    if (values == nullptr) return {};
    std::string result;
    const auto count = env->GetArrayLength(values);
    for (jsize index = 0; index < count; ++index) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(values, index));
        auto line = utf8(env, value);
        env->DeleteLocalRef(value);
        line.erase(std::remove(line.begin(), line.end(), '\r'), line.end());
        line.erase(std::remove(line.begin(), line.end(), '\n'), line.end());
        if (line.empty()) continue;
        if (!result.empty()) result += ',';
        result += line;
    }
    return result;
}

void option(mpv_handle *mpv, const char *name, const std::string &value) {
    mpv_set_option_string(mpv, name, value.c_str());
}

void configure(
    mpv_handle *mpv,
    jlong windowId,
    const std::string &headers,
    jlong startPositionMs,
    jboolean paused,
    const char *gpuContext,
    const char *hardwareDecoder
) {
    option(mpv, "wid", std::to_string(static_cast<std::int64_t>(windowId)));
    option(mpv, "vo", "gpu");
    option(mpv, "gpu-context", gpuContext);
    option(mpv, "hwdec", hardwareDecoder);
    option(mpv, "gpu-hwdec-interop", "auto");
    option(mpv, "vd-lavc-software-fallback", "yes");
    option(mpv, "force-window", "immediate");
    option(mpv, "force-seekable", "yes");
    option(mpv, "keep-open", "yes");
    option(mpv, "idle", "yes");
    option(mpv, "osc", "no");
    option(mpv, "osd-level", "0");
    option(mpv, "input-default-bindings", "no");
    option(mpv, "input-vo-keyboard", "no");
    option(mpv, "input-cursor", "no");
    option(mpv, "audio-channels", "auto");
    option(mpv, "target-colorspace-hint", "yes");
    if (!headers.empty()) option(mpv, "http-header-fields", headers);
    if (startPositionMs > 0) {
        option(mpv, "start", std::to_string(static_cast<double>(startPositionMs) / 1000.0));
    }
    if (paused == JNI_TRUE) option(mpv, "pause", "yes");
}

mpv_handle *initializeMpv(
    jlong windowId,
    const std::string &headers,
    jlong startPositionMs,
    jboolean paused
) {
    const char *pinnedContext = std::getenv("CONDUIT_MPV_GPU_CONTEXT");
    const char *pinnedDecoder = std::getenv("CONDUIT_MPV_HWDEC");
    struct Attempt {
        const char *context;
        const char *decoder;
    };
    const Attempt attempts[] = {
        {
            pinnedContext != nullptr && *pinnedContext != '\0' ? pinnedContext : "x11egl",
            pinnedDecoder != nullptr && *pinnedDecoder != '\0' ? pinnedDecoder : "auto",
        },
        {
            "x11vk",
            pinnedDecoder != nullptr && *pinnedDecoder != '\0' ? pinnedDecoder : "nvdec-copy",
        },
    };
    const int attemptCount = pinnedContext != nullptr && *pinnedContext != '\0' ? 1 : 2;
    for (int index = 0; index < attemptCount; ++index) {
        mpv_handle *mpv = mpv_create();
        if (mpv == nullptr) return nullptr;
        configure(
            mpv,
            windowId,
            headers,
            startPositionMs,
            paused,
            attempts[index].context,
            attempts[index].decoder
        );
        if (mpv_initialize(mpv) >= 0) return mpv;
        mpv_destroy(mpv);
    }
    return nullptr;
}

template <typename Result, typename Action>
Result withPlayer(jlong handle, Result fallback, Action action) {
    auto *player = reinterpret_cast<Player *>(handle);
    if (player == nullptr) return fallback;
    std::lock_guard<std::mutex> playersGuard(playersMutex);
    if (players.find(player) == players.end()) return fallback;
    std::lock_guard<std::mutex> playerGuard(player->mutex);
    return action(player->mpv);
}

double numberProperty(mpv_handle *mpv, const char *name) {
    double value = 0.0;
    return mpv_get_property(mpv, name, MPV_FORMAT_DOUBLE, &value) >= 0 ? value : 0.0;
}

std::int64_t integerProperty(mpv_handle *mpv, const char *name) {
    std::int64_t value = 0;
    return mpv_get_property(mpv, name, MPV_FORMAT_INT64, &value) >= 0 ? value : 0;
}

bool flagProperty(mpv_handle *mpv, const char *name) {
    int value = 0;
    return mpv_get_property(mpv, name, MPV_FORMAT_FLAG, &value) >= 0 && value != 0;
}

}  // namespace

extern "C" {

#define BRIDGE(name) Java_media_conduit_client_DesktopNativePlayerBridge_##name

JNIEXPORT jlong JNICALL BRIDGE(create)(
    JNIEnv *env,
    jobject,
    jlong windowId,
    jstring sourceUrl,
    jobjectArray headers,
    jlong startPositionMs,
    jboolean paused
) {
    if (windowId == 0 || sourceUrl == nullptr) return 0;
    std::setlocale(LC_NUMERIC, "C");
    mpv_handle *mpv = initializeMpv(
        windowId,
        headerFields(env, headers),
        startPositionMs,
        paused
    );
    if (mpv == nullptr) return 0;

    const auto url = utf8(env, sourceUrl);
    const char *command[] = {"loadfile", url.c_str(), nullptr};
    if (mpv_command(mpv, command) < 0) {
        mpv_terminate_destroy(mpv);
        return 0;
    }

    auto *player = new Player{mpv};
    {
        std::lock_guard<std::mutex> guard(playersMutex);
        players.insert(player);
    }
    return reinterpret_cast<jlong>(player);
}

JNIEXPORT void JNICALL BRIDGE(dispose)(JNIEnv *, jobject, jlong handle) {
    auto *player = reinterpret_cast<Player *>(handle);
    if (player == nullptr) return;
    std::unique_lock<std::mutex> playersGuard(playersMutex);
    if (players.erase(player) == 0) return;
    std::unique_lock<std::mutex> playerGuard(player->mutex);
    playersGuard.unlock();
    mpv_terminate_destroy(player->mpv);
    player->mpv = nullptr;
    playerGuard.unlock();
    delete player;
}

JNIEXPORT void JNICALL BRIDGE(setPaused)(JNIEnv *, jobject, jlong handle, jboolean paused) {
    withPlayer<int>(handle, 0, [paused](mpv_handle *mpv) {
        int value = paused == JNI_TRUE ? 1 : 0;
        mpv_set_property(mpv, "pause", MPV_FORMAT_FLAG, &value);
        return 0;
    });
}

JNIEXPORT void JNICALL BRIDGE(seekTo)(JNIEnv *, jobject, jlong handle, jlong positionMs) {
    withPlayer<int>(handle, 0, [positionMs](mpv_handle *mpv) {
        const auto seconds = std::to_string(static_cast<double>(positionMs) / 1000.0);
        const char *command[] = {"seek", seconds.c_str(), "absolute+exact", nullptr};
        mpv_command(mpv, command);
        return 0;
    });
}

JNIEXPORT jlong JNICALL BRIDGE(positionMs)(JNIEnv *, jobject, jlong handle) {
    return withPlayer<jlong>(handle, 0, [](mpv_handle *mpv) {
        return static_cast<jlong>(numberProperty(mpv, "time-pos") * 1000.0);
    });
}

JNIEXPORT jlong JNICALL BRIDGE(durationMs)(JNIEnv *, jobject, jlong handle) {
    return withPlayer<jlong>(handle, 0, [](mpv_handle *mpv) {
        return static_cast<jlong>(numberProperty(mpv, "duration") * 1000.0);
    });
}

JNIEXPORT jint JNICALL BRIDGE(videoWidth)(JNIEnv *, jobject, jlong handle) {
    return withPlayer<jint>(handle, 0, [](mpv_handle *mpv) {
        return static_cast<jint>(integerProperty(mpv, "dwidth"));
    });
}

JNIEXPORT jint JNICALL BRIDGE(videoHeight)(JNIEnv *, jobject, jlong handle) {
    return withPlayer<jint>(handle, 0, [](mpv_handle *mpv) {
        return static_cast<jint>(integerProperty(mpv, "dheight"));
    });
}

JNIEXPORT jboolean JNICALL BRIDGE(isPaused)(JNIEnv *, jobject, jlong handle) {
    return withPlayer<jboolean>(handle, JNI_TRUE, [](mpv_handle *mpv) {
        return flagProperty(mpv, "pause") ? JNI_TRUE : JNI_FALSE;
    });
}

JNIEXPORT jboolean JNICALL BRIDGE(isLoading)(JNIEnv *, jobject, jlong handle) {
    return withPlayer<jboolean>(handle, JNI_TRUE, [](mpv_handle *mpv) {
        const bool loading = flagProperty(mpv, "paused-for-cache") ||
            numberProperty(mpv, "duration") <= 0.0;
        return loading ? JNI_TRUE : JNI_FALSE;
    });
}

JNIEXPORT jboolean JNICALL BRIDGE(isEnded)(JNIEnv *, jobject, jlong handle) {
    return withPlayer<jboolean>(handle, JNI_FALSE, [](mpv_handle *mpv) {
        return flagProperty(mpv, "eof-reached") ? JNI_TRUE : JNI_FALSE;
    });
}

}  // extern "C"
