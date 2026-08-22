import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import Metal

struct ConduitPipPlaybackClockSnapshot: Equatable {
    let positionMs: Int64
    let durationMs: Int64
    let isPlaying: Bool
    let playbackRate: Double
    let videoFrameRate: Double
    let sampledAtUptime: TimeInterval
    let generation: UInt64

    static let empty = ConduitPipPlaybackClockSnapshot(
        positionMs: 0,
        durationMs: 0,
        isPlaying: false,
        playbackRate: 1,
        videoFrameRate: 30,
        sampledAtUptime: 0,
        generation: 0
    )

    /// MPV's clock advances between refresh polls, so capture timestamps are
    /// extrapolated from the last poll instead of stepping at poll cadence.
    func interpolatedPositionSeconds(at uptime: TimeInterval) -> Double {
        guard sampledAtUptime > 0 else { return Double(positionMs) / 1_000 }
        let elapsed = max(0, uptime - sampledAtUptime)
        guard isPlaying, playbackRate > 0 else { return Double(positionMs) / 1_000 }
        return (Double(positionMs) + elapsed * 1_000 * playbackRate) / 1_000
    }
}

/// Publishes the MPV clock to the Metal presentation thread without exposing
/// the player controller's mutable state to capture work.
final class ConduitPipPlaybackClock {
    private let lock = NSLock()
    private var value = ConduitPipPlaybackClockSnapshot.empty
    private var generation: UInt64 = 0

    func update(
        positionMs: Int64,
        durationMs: Int64,
        isPlaying: Bool,
        playbackRate: Double,
        videoFrameRate: Double
    ) {
        lock.lock()
        generation &+= 1
        value = ConduitPipPlaybackClockSnapshot(
            positionMs: max(positionMs, 0),
            durationMs: max(durationMs, 0),
            isPlaying: isPlaying,
            playbackRate: playbackRate > 0 ? playbackRate : 1,
            videoFrameRate: videoFrameRate > 0 ? videoFrameRate : 30,
            sampledAtUptime: ProcessInfo.processInfo.systemUptime,
            generation: generation
        )
        lock.unlock()
    }

    func reset(positionMs: Int64? = nil) {
        lock.lock()
        generation &+= 1
        value = ConduitPipPlaybackClockSnapshot(
            positionMs: max(positionMs ?? value.positionMs, 0),
            durationMs: value.durationMs,
            isPlaying: value.isPlaying,
            playbackRate: value.playbackRate,
            videoFrameRate: value.videoFrameRate,
            sampledAtUptime: ProcessInfo.processInfo.systemUptime,
            generation: generation
        )
        lock.unlock()
    }

    func snapshot() -> ConduitPipPlaybackClockSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

/// Pure geometry policy mapping MPV's drawable onto a PiP sample buffer.
///
/// - Aspect-fit modes letterbox the video inside the surface, so the buffer
///   center-crops the fitted video rect. Publishing the whole surface would
///   bake the inline bars - and therefore the window's aspect - into the PiP
///   window.
/// - Fill/Zoom modes render edge-to-edge, so the whole surface is the picture.
/// - An unknown video size has no defined crop, so frames are skipped rather
///   than published with a device-shaped aspect.
enum ConduitPipVideoRegionPolicy: Equatable {
    case fullSurface
    case centeredCrop(width: Int, height: Int)
    case skip

    static func decision(
        textureWidth: Int,
        textureHeight: Int,
        videoWidth: Double,
        videoHeight: Double,
        videoFillsSurface: Bool
    ) -> ConduitPipVideoRegionPolicy {
        if videoFillsSurface { return .fullSurface }
        guard videoWidth > 0, videoHeight > 0, textureWidth > 0, textureHeight > 0 else { return .skip }

        let videoAspect = videoWidth / videoHeight
        let textureAspect = Double(textureWidth) / Double(textureHeight)
        var fittedWidth = Double(textureWidth)
        var fittedHeight = Double(textureHeight)
        if videoAspect > textureAspect {
            fittedHeight = fittedWidth / videoAspect
        } else if videoAspect < textureAspect {
            fittedWidth = fittedHeight * videoAspect
        }

        let width = max(2, Int(fittedWidth.rounded(.down)) & ~1)
        let height = max(2, Int(fittedHeight.rounded(.down)) & ~1)
        guard width <= textureWidth, height <= textureHeight else { return .skip }
        if width == textureWidth, height == textureHeight { return .fullSurface }
        return .centeredCrop(width: width, height: height)
    }
}

/// Copies presented MPV textures into IOSurface-backed sample buffers without
/// creating a second decoder or reading pixels back through the CPU.
///
/// Capture is armed only when it is needed: while priming a PiP start, while
/// PiP is active, or for a short render burst after layout/seek/pause/
/// foreground changes. Every armed frame is marked DisplayImmediately so the
/// sample-buffer layer shows each sample on arrival instead of pacing against
/// extrapolated presentation timestamps.
final class ConduitPictureInPictureFrameCapture {
    private let displayLayer: AVSampleBufferDisplayLayer
    private let metalLayer: ConduitMetalLayer
    private let clockProvider: () -> ConduitPipPlaybackClockSnapshot
    private let videoSizeProvider: () -> CGSize
    private let fillsSurfaceProvider: () -> Bool

    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private var textureCache: CVMetalTextureCache?

    /// Serializes sample delivery. GPU completion handlers may run
    /// concurrently, so this queue is what guarantees frames reach the
    /// display layer in presentation order.
    private let captureQueue = DispatchQueue(
        label: "media.conduit.pip-frame-capture",
        qos: .userInitiated
    )

    private let stateLock = NSLock()
    private var pixelBufferPool: CVPixelBufferPool?
    private var poolWidth = 0
    private var poolHeight = 0
    private var poolPixelFormat: OSType = 0
    private var formatDescription: CMVideoFormatDescription?

    private var isPriming = false
    private var isActive = false
    private var stopPrimingAfterFirstFrame = false
    private var burstFramesRemaining = 0
    private var firstFrameHandler: (() -> Void)?
    private var lastCaptureTime: CFTimeInterval = 0
    private var enqueuedFrameCount: UInt64 = 0
    private var inFlightCaptures = 0
    private var hasBlitInFlight = false
    private var loggedUnsupportedFormat = false
    private var smoothedPtsSeconds: Double = 0
    private var smoothedPtsUptime: TimeInterval = 0

#if DEBUG
    private var lastDeliveredPtsSeconds: Double = 0
    private var pacingSequence: Int = 0
    private var lastCompletionUptime: TimeInterval = 0
    private var lastClaimInterval: CFTimeInterval = 0
    private var previousCaptureTime: CFTimeInterval = 0
#endif

    init?(
        displayLayer: AVSampleBufferDisplayLayer,
        metalLayer: ConduitMetalLayer,
        clockProvider: @escaping () -> ConduitPipPlaybackClockSnapshot,
        videoSizeProvider: @escaping () -> CGSize,
        fillsSurfaceProvider: @escaping () -> Bool
    ) {
        guard
            let device = metalLayer.device ?? MTLCreateSystemDefaultDevice(),
            let queue = device.makeCommandQueue()
        else {
            print("[Conduit PiP] Unable to create Metal device/queue for capture")
            return nil
        }

        self.displayLayer = displayLayer
        self.metalLayer = metalLayer
        self.clockProvider = clockProvider
        self.videoSizeProvider = videoSizeProvider
        self.fillsSurfaceProvider = fillsSurfaceProvider
        self.device = device
        self.commandQueue = queue

        CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &textureCache)
    }

    var enqueuedFrames: UInt64 {
        stateLock.lock()
        defer { stateLock.unlock() }
        return enqueuedFrameCount
    }

    var isArmed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return isPriming || isActive || burstFramesRemaining > 0
    }

    // MARK: - Arming

    /// Arms capture until the first frame lands in the display layer. For a
    /// manual PiP start the handler fires once and priming stops; automatic
    /// prewarm keeps capturing so the layer always holds a fresh frame.
    func startPriming(stopAfterFirstFrame: Bool, onFirstFrame: @escaping () -> Void) {
        stateLock.lock()
        isPriming = true
        stopPrimingAfterFirstFrame = stopAfterFirstFrame
        firstFrameHandler = onFirstFrame
        burstFramesRemaining = max(burstFramesRemaining, 3)
        stateLock.unlock()
        updateArmedState()
    }

    func markActive(_ active: Bool) {
        if active { resyncPresentationClock() }
        stateLock.lock()
        isActive = active
        if active {
            isPriming = false
            firstFrameHandler = nil
            stopPrimingAfterFirstFrame = false
        }
        stateLock.unlock()
        updateArmedState()
    }

    func setPaused(_ paused: Bool) {
        if paused { requestRenderBurst(count: 2) }
    }

    func didSeek() {
        resyncPresentationClock()
        requestRenderBurst(count: 3)
    }

    func setBackgrounded(_ backgrounded: Bool) {
        metalLayer.capturesWithoutPresentation = backgrounded
        metalLayer.releasePendingDrawable()
        logCapture(
            "PiP capture mode=\(backgrounded ? "deferred" : "presented") enqueued=\(enqueuedFrames)"
        )
        if backgrounded { requestRenderBurst(count: 4) }
    }

    func requestRenderBurst(count: Int) {
        stateLock.lock()
        burstFramesRemaining = max(burstFramesRemaining, count)
        stateLock.unlock()
        updateArmedState()
    }

    /// Disarms every capture source. The completion runs once no blit that
    /// borrowed an MPV drawable is still in flight, bounded by a short
    /// timeout so player teardown never hangs on a stuck GPU submission.
    func stopRendering(removeDisplayedImage: Bool, completion: (() -> Void)? = nil) {
        stateLock.lock()
        isPriming = false
        isActive = false
        stopPrimingAfterFirstFrame = false
        burstFramesRemaining = 0
        firstFrameHandler = nil
        stateLock.unlock()
        updateArmedState()

        let finish = { [weak self] in
            if removeDisplayedImage {
                self?.flushDisplayLayer(removeImage: true)
            }
            completion?()
        }
        waitUntilIdle(timeout: .milliseconds(250), completion: finish)
    }

    func waitUntilIdle(timeout: DispatchTimeInterval, completion: @escaping () -> Void) {
        let deadline = DispatchTime.now() + timeout
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else {
                completion()
                return
            }
            while true {
                self.stateLock.lock()
                let inFlight = self.inFlightCaptures
                self.stateLock.unlock()
                if inFlight == 0 || DispatchTime.now() >= deadline { break }
                Thread.sleep(forTimeInterval: 0.005)
            }
            completion()
        }
    }

    /// Submits a retained pre-presented texture. Priming can begin between
    /// two MPV presents (for example while paused), and waiting for a render
    /// that will not come would stall the PiP start. Routed through the
    /// capture queue so it lands after any in-flight delivery released the
    /// blit gate.
    func submitRetainedTexture(_ texture: MTLTexture, presentationID: UInt64) {
        captureQueue.async { [self] in
            handlePresentedTexture(texture, presentationID: presentationID, sourceLifetime: nil)
        }
    }

    // MARK: - Capture

    func handlePresentedTexture(
        _ sourceTexture: MTLTexture,
        presentationID: UInt64,
        sourceLifetime: AnyObject?
    ) {
        guard !metalLayer.isSuspended else { return }

        stateLock.lock()
        let shouldCapture = isPriming || isActive || burstFramesRemaining > 0
        guard shouldCapture else {
            stateLock.unlock()
            return
        }
        // One blit in flight at a time: the previous sample is delivered
        // before the next capture starts, which makes presentation order and
        // enqueue order identical by construction. A blit takes well under a
        // present interval, so skipping while one is in flight costs nothing.
        guard !hasBlitInFlight else {
            stateLock.unlock()
            return
        }

        // Until MPV reports the video size there is no defined crop (for
        // example across a vid rebind), and capture must not publish a
        // window-shaped frame with baked-in bars. Skip before claiming any
        // burst or blit budget so recovery refills the layer immediately.
        let videoSize = videoSizeProvider()
        guard fillsSurfaceProvider() || (videoSize.width > 0 && videoSize.height > 0) else {
            stateLock.unlock()
            logCapture("skipping frame with unknown video size")
            return
        }

        let now = CACurrentMediaTime()
        let clock = clockProvider()
        let frameRate = max(12.0, clock.videoFrameRate)
        let minimumInterval = 1.0 / (frameRate * max(0.5, clock.playbackRate))
        if burstFramesRemaining == 0 && (now - lastCaptureTime) < minimumInterval * 0.5 {
            stateLock.unlock()
            return
        }
        lastCaptureTime = now
        #if DEBUG
        lastClaimInterval = clock.isPlaying ? now - previousCaptureTime : 0
        previousCaptureTime = now
        #endif
        if burstFramesRemaining > 0 { burstFramesRemaining -= 1 }
        hasBlitInFlight = true
        inFlightCaptures += 1
        let ptsSeconds = nextPresentationSeconds(for: clock, at: ProcessInfo.processInfo.systemUptime)
        stateLock.unlock()

        enqueue(
            texture: sourceTexture,
            sourceLifetime: sourceLifetime,
            clock: clock,
            ptsSeconds: ptsSeconds
        )
        updateArmedState()
    }

    /// Integrates wall-clock playback time between captures instead of
    /// re-reading MPV's quantized position per frame, so consecutive sample
    /// timestamps advance smoothly with the real capture cadence.
    private func nextPresentationSeconds(
        for clock: ConduitPipPlaybackClockSnapshot,
        at uptime: TimeInterval
    ) -> Double {
        let rate = clock.isPlaying ? min(max(clock.playbackRate, 0.25), 4.0) : 0
        if smoothedPtsUptime == 0 {
            smoothedPtsSeconds = clock.interpolatedPositionSeconds(at: uptime)
        } else {
            smoothedPtsSeconds += max(0, uptime - smoothedPtsUptime) * rate
        }
        smoothedPtsUptime = uptime
        return max(smoothedPtsSeconds, 0)
    }

    /// Re-anchors the integrated timestamp after a timeline jump.
    private func resyncPresentationClock() {
        stateLock.lock()
        smoothedPtsUptime = 0
        stateLock.unlock()
    }

    /// Releases the single-blit gate on paths where no completion handler
    /// will ever fire.
    private func abandonBlit() {
        stateLock.lock()
        hasBlitInFlight = false
        inFlightCaptures -= 1
        stateLock.unlock()
    }

    private func enqueue(
        texture source: MTLTexture,
        sourceLifetime: AnyObject?,
        clock: ConduitPipPlaybackClockSnapshot,
        ptsSeconds: Double
    ) {
        withExtendedLifetime(sourceLifetime) {}

        guard let pixelFormat = Self.pixelBufferFormat(for: source.pixelFormat) else {
            stateLock.lock()
            let alreadyLogged = loggedUnsupportedFormat
            loggedUnsupportedFormat = true
            stateLock.unlock()
            if !alreadyLogged {
                print(
                    "[Conduit PiP] Unsupported drawable pixel format " +
                        "\(source.pixelFormat.rawValue) for capture"
                )
            }
            abandonBlit()
            return
        }

        let region = videoRegion(in: source)
        guard
            let region,
            let pixelBuffer = makePixelBuffer(
                width: region.size.width,
                height: region.size.height,
                format: pixelFormat
            ),
            let destination = makeTexture(from: pixelBuffer, pixelFormat: source.pixelFormat),
            let commandBuffer = commandQueue.makeCommandBuffer(),
            let blit = commandBuffer.makeBlitCommandEncoder()
        else {
            abandonBlit()
            return
        }

        blit.copy(
            from: source,
            sourceSlice: 0,
            sourceLevel: 0,
            sourceOrigin: region.origin,
            sourceSize: region.size,
            to: destination,
            destinationSlice: 0,
            destinationLevel: 0,
            destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
        )
        blit.endEncoding()
        commandBuffer.addCompletedHandler { [weak self] _ in
            // The blit gate stays held until delivery finishes on the serial
            // capture queue, so the next captured frame can never overtake
            // this one and appear in the PiP window before it.
            guard let self else { return }
            #if DEBUG
            let completedAt = ProcessInfo.processInfo.systemUptime
            #endif
            self.captureQueue.async {
                #if DEBUG
                self.lastCompletionUptime = completedAt
                #endif
                self.enqueueSampleBuffer(
                    for: pixelBuffer,
                    clock: clock,
                    ptsSeconds: ptsSeconds
                )
                self.abandonBlit()
            }
        }
        commandBuffer.commit()
    }

    /// Maps the drawable onto the picture region via ConduitPipVideoRegionPolicy.
    /// Returns nil when no correct region exists (unknown video size in an
    /// aspect-fit mode); the caller skips the frame instead of publishing a
    /// wrong-aspect buffer.
    private func videoRegion(in texture: MTLTexture) -> (origin: MTLOrigin, size: MTLSize)? {
        let video = videoSizeProvider()
        switch ConduitPipVideoRegionPolicy.decision(
            textureWidth: texture.width,
            textureHeight: texture.height,
            videoWidth: video.width,
            videoHeight: video.height,
            videoFillsSurface: fillsSurfaceProvider()
        ) {
        case .fullSurface:
            return (
                origin: MTLOrigin(x: 0, y: 0, z: 0),
                size: MTLSize(width: texture.width, height: texture.height, depth: 1)
            )
        case .centeredCrop(let width, let height):
            return (
                origin: MTLOrigin(x: (texture.width - width) / 2, y: (texture.height - height) / 2, z: 0),
                size: MTLSize(width: width, height: height, depth: 1)
            )
        case .skip:
            return nil
        }
    }

    private func enqueueSampleBuffer(
        for pixelBuffer: CVPixelBuffer,
        clock: ConduitPipPlaybackClockSnapshot,
        ptsSeconds: Double
    ) {
        attachColorAttributes(to: pixelBuffer)

        stateLock.lock()
        var description = formatDescription
        if description == nil ||
            !CMVideoFormatDescriptionMatchesImageBuffer(description!, imageBuffer: pixelBuffer) {
            var created: CMVideoFormatDescription?
            CMVideoFormatDescriptionCreateForImageBuffer(
                allocator: kCFAllocatorDefault,
                imageBuffer: pixelBuffer,
                formatDescriptionOut: &created
            )
            formatDescription = created
            description = created
        }
        stateLock.unlock()

        guard let description else { return }

        let presentationTime = CMTime(seconds: ptsSeconds, preferredTimescale: 90_000)

        var timing = CMSampleTimingInfo(
            duration: CMTime(
                value: 1,
                timescale: Int32(max(12.0, clock.videoFrameRate))
            ),
            presentationTimeStamp: presentationTime,
            decodeTimeStamp: .invalid
        )

        var sampleBuffer: CMSampleBuffer?
        let status = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescription: description,
            sampleTiming: &timing,
            sampleBufferOut: &sampleBuffer
        )
        guard status == noErr, let sampleBuffer else { return }

        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true),
           CFArrayGetCount(attachments) > 0 {
            let dictionary = unsafeBitCast(
                CFArrayGetValueAtIndex(attachments, 0),
                to: CFMutableDictionary.self
            )
            CFDictionarySetValue(
                dictionary,
                Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
            )
        }

        // Deliver from the capture queue, not the main thread. Main-thread
        // congestion (Compose UI, CA transactions) arrives as irregular
        // enqueue spacing that DisplayImmediately shows literally, which is
        // visible as PiP-only frame-pacing jitter. The sample-buffer layer's
        // enqueue paths are thread-safe.
        deliverSample(sampleBuffer)
    }

    private func deliverSample(_ sampleBuffer: CMSampleBuffer) {
        let deliveredAt = ProcessInfo.processInfo.systemUptime

        if displayLayer.status == .failed {
            logCapture("display layer failed; flushing before retry")
            flushDisplayLayer(removeImage: true)
        }

        if #available(iOS 18.0, *) {
            let renderer = displayLayer.sampleBufferRenderer
            guard renderer.isReadyForMoreMediaData else {
                recordPacing(sampleBuffer, deliveredAt: deliveredAt, dropped: true)
                return
            }
            renderer.enqueue(sampleBuffer)
        } else {
            guard displayLayer.isReadyForMoreMediaData else {
                recordPacing(sampleBuffer, deliveredAt: deliveredAt, dropped: true)
                return
            }
            displayLayer.enqueue(sampleBuffer)
        }

        stateLock.lock()
        enqueuedFrameCount &+= 1
        let handler = firstFrameHandler
        let shouldStop = stopPrimingAfterFirstFrame
        firstFrameHandler = nil
        if shouldStop { isPriming = false }
        stateLock.unlock()

        handler?()

        recordPacing(sampleBuffer, deliveredAt: deliveredAt, dropped: false)
    }

    /// DEBUG-only cadence telemetry: PTS deltas and delivery gaps make frame
    /// pacing measurable instead of eyeball-confirmed.
    private func recordPacing(
        _ sampleBuffer: CMSampleBuffer,
        deliveredAt: TimeInterval,
        dropped: Bool
    ) {
        #if DEBUG
        let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        stateLock.lock()
        let previousPts = lastDeliveredPtsSeconds
        lastDeliveredPtsSeconds = pts
        pacingSequence &+= 1
        let sequence = pacingSequence
        stateLock.unlock()

        let shouldLog = sequence <= 40 || sequence % 30 == 0 || dropped
        guard shouldLog else { return }
        let ptsDelta = previousPts > 0 ? (pts - previousPts) * 1_000 : 0
        stateLock.lock()
        let claimInterval = lastClaimInterval * 1_000
        stateLock.unlock()
        logCapture(
            String(
                format: "pacing seq=%d %@ ptsDelta=%.1fms captureDelta=%.1fms gap=%.1fms",
                sequence,
                dropped ? "DROPPED" : "enqueued",
                ptsDelta,
                claimInterval,
                (deliveredAt - lastCompletionUptime) * 1_000
            )
        )
        #endif
    }

    private func flushDisplayLayer(removeImage: Bool) {
        if Thread.isMainThread {
            flushNow(removeImage: removeImage)
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.flushNow(removeImage: removeImage)
            }
        }
    }

    private func flushNow(removeImage: Bool) {
        if #available(iOS 18.0, *) {
            displayLayer.sampleBufferRenderer.flush(
                removingDisplayedImage: removeImage,
                completionHandler: nil
            )
        } else if removeImage {
            displayLayer.flushAndRemoveImage()
        } else {
            displayLayer.flush()
        }
    }

    private func updateArmedState() {
        stateLock.lock()
        let armed = isPriming || isActive || burstFramesRemaining > 0
        stateLock.unlock()
        metalLayer.isDrawableCaptureArmed = armed
    }

    // MARK: - Resources

    private func makePixelBuffer(width: Int, height: Int, format: OSType) -> CVPixelBuffer? {
        stateLock.lock()
        if pixelBufferPool == nil || poolWidth != width || poolHeight != height || poolPixelFormat != format {
            poolWidth = width
            poolHeight = height
            poolPixelFormat = format
            formatDescription = nil
            let attributes: [CFString: Any] = [
                kCVPixelBufferPixelFormatTypeKey: format,
                kCVPixelBufferWidthKey: width,
                kCVPixelBufferHeightKey: height,
                kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
                kCVPixelBufferMetalCompatibilityKey: true,
            ]
            var pool: CVPixelBufferPool?
            let poolAttributes: [CFString: Any] = [
                kCVPixelBufferPoolMinimumBufferCountKey: 4,
            ]
            if CVPixelBufferPoolCreate(
                kCFAllocatorDefault,
                poolAttributes as CFDictionary,
                attributes as CFDictionary,
                &pool
            ) == kCVReturnSuccess {
                pixelBufferPool = pool
            } else {
                logCapture("pixel buffer pool creation failed \(width)x\(height)")
            }
        }
        let pool = pixelBufferPool
        stateLock.unlock()

        guard let pool else { return nil }
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer) == kCVReturnSuccess else {
            return nil
        }
        return pixelBuffer
    }

    private func makeTexture(from pixelBuffer: CVPixelBuffer, pixelFormat: MTLPixelFormat) -> MTLTexture? {
        guard let textureCache else { return nil }
        var cvTexture: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault,
            textureCache,
            pixelBuffer,
            nil,
            pixelFormat,
            CVPixelBufferGetWidth(pixelBuffer),
            CVPixelBufferGetHeight(pixelBuffer),
            0,
            &cvTexture
        )
        guard status == kCVReturnSuccess, let cvTexture else { return nil }
        return CVMetalTextureGetTexture(cvTexture)
    }

    private func attachColorAttributes(to pixelBuffer: CVPixelBuffer) {
        if let colorSpace = metalLayer.colorspace {
            CVBufferSetAttachment(
                pixelBuffer,
                kCVImageBufferCGColorSpaceKey,
                colorSpace,
                .shouldPropagate
            )
            return
        }

        CVBufferSetAttachment(
            pixelBuffer,
            kCVImageBufferColorPrimariesKey,
            kCVImageBufferColorPrimaries_ITU_R_709_2,
            .shouldPropagate
        )
        CVBufferSetAttachment(
            pixelBuffer,
            kCVImageBufferTransferFunctionKey,
            kCVImageBufferTransferFunction_ITU_R_709_2,
            .shouldPropagate
        )
        CVBufferSetAttachment(
            pixelBuffer,
            kCVImageBufferYCbCrMatrixKey,
            kCVImageBufferYCbCrMatrix_ITU_R_709_2,
            .shouldPropagate
        )
    }

    private static func pixelBufferFormat(for format: MTLPixelFormat) -> OSType? {
        switch format {
        case .rgba16Float:
            return kCVPixelFormatType_64RGBAHalf
        case .bgr10a2Unorm:
            return kCVPixelFormatType_ARGB2101010LEPacked
        case .bgra8Unorm, .bgra8Unorm_srgb:
            return kCVPixelFormatType_32BGRA
        default:
            return nil
        }
    }

    private func logCapture(_ message: String) {
        #if DEBUG
        print("[Conduit PiP][capture] \(message)")
        #endif
    }
}
