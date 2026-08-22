import Foundation

/// Decision for the software renderer's pixel-buffer dimensions.
enum ConduitRenderSizeDecision: Equatable {
    case size(width: Int, height: Int)
    case skip
}

/// Pure sizing policy for the libmpv software render target.
///
/// The buffer doubles as the PiP source, so its aspect ratio is what AVKit
/// sizes the PiP window from:
///
/// - Fit mode renders at the video's display aspect, so buffers carry the
///   picture edge-to-edge and the PiP window matches the video by
///   construction - no letterbox bars can ever be baked in.
/// - Fill/Zoom modes render at the surface aspect, matching mpv's panscan,
///   which fills that area edge-to-edge as well.
///
/// A long-side cap bounds the CPU cost of the software renderer; the display
/// layer upscales to the screen with aspect fit.
enum ConduitRenderSizePolicy {
    static func decision(
        surfaceWidth: Double,
        surfaceHeight: Double,
        videoWidth: Double,
        videoHeight: Double,
        videoFillsSurface: Bool,
        maxLongSide: Int
    ) -> ConduitRenderSizeDecision {
        guard surfaceWidth > 1, surfaceHeight > 1, maxLongSide >= 16 else { return .skip }

        var width = surfaceWidth
        var height = surfaceHeight
        if !videoFillsSurface, videoWidth > 0, videoHeight > 0 {
            let videoAspect = videoWidth / videoHeight
            if videoAspect > 1 {
                height = width / videoAspect
            } else if videoAspect < 1 {
                width = height * videoAspect
            } else {
                let smaller = min(width, height)
                width = smaller
                height = smaller
            }
        }

        let longSide = max(width, height)
        guard longSide > 1 else { return .skip }
        let scale = min(1, Double(maxLongSide) / longSide)
        width = (width * scale).rounded(.down)
        height = (height * scale).rounded(.down)

        let evenWidth = max(2, Int(width) & ~1)
        let evenHeight = max(2, Int(height) & ~1)
        guard evenWidth > 1, evenHeight > 1 else { return .skip }
        return .size(width: evenWidth, height: evenHeight)
    }
}
