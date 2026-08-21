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

    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private var textureCache: CVMetalTextureCache?

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
    private var loggedUnsupportedFormat = false

    init?(
        displayLayer: AVSampleBufferDisplayLayer,
        metalLayer: ConduitMetalLayer,
        clockProvider: @escaping () -> ConduitPipPlaybackClockSnapshot,
        videoSizeProvider: @escaping () -> CGSize
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
        self.device = device
        self.commandQueue = queue

        CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, device, nil, &textureCache)
    }

    var enqueuedFrames: UInt64 {
        stateLock.lock()
        defer { stateLock.unlock() }
        return enqueuedFrameCount
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
    /// that will not come would stall the PiP start.
    func submitRetainedTexture(_ texture: MTLTexture, presentationID: UInt64) {
        handlePresentedTexture(texture, presentationID: presentationID, sourceLifetime: nil)
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

        let now = CACurrentMediaTime()
        let clock = clockProvider()
        let frameRate = max(12.0, clock.videoFrameRate)
        let minimumInterval = 1.0 / (frameRate * max(0.5, clock.playbackRate))
        if burstFramesRemaining == 0 && (now - lastCaptureTime) < minimumInterval * 0.5 {
            stateLock.unlock()
            return
        }
        lastCaptureTime = now
        if burstFramesRemaining > 0 { burstFramesRemaining -= 1 }
        inFlightCaptures += 1
        stateLock.unlock()

        enqueue(
            texture: sourceTexture,
            sourceLifetime: sourceLifetime,
            clock: clock
        )
        updateArmedState()
    }

    private func enqueue(
        texture source: MTLTexture,
        sourceLifetime: AnyObject?,
        clock: ConduitPipPlaybackClockSnapshot
    ) {
        defer {
            stateLock.lock()
            inFlightCaptures -= 1
            stateLock.unlock()
        }
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
            return
        }

        let region = videoRegion(in: source)
        guard
            let pixelBuffer = makePixelBuffer(
                width: region.size.width,
                height: region.size.height,
                format: pixelFormat
            ),
            let destination = makeTexture(from: pixelBuffer, pixelFormat: source.pixelFormat),
            let commandBuffer = commandQueue.makeCommandBuffer(),
            let blit = commandBuffer.makeBlitCommandEncoder()
        else {
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
            self?.enqueueSampleBuffer(for: pixelBuffer, clock: clock)
        }
        commandBuffer.commit()
    }

    /// Center-crops the aspect-fitted video region so the PiP buffer carries
    /// the picture rather than the inline surface's letterbox bars.
    private func videoRegion(in texture: MTLTexture) -> (origin: MTLOrigin, size: MTLSize) {
        let whole = (
            origin: MTLOrigin(x: 0, y: 0, z: 0),
            size: MTLSize(width: texture.width, height: texture.height, depth: 1)
        )

        let video = videoSizeProvider()
        guard video.width > 0, video.height > 0, texture.width > 0, texture.height > 0 else {
            return whole
        }

        let videoAspect = Double(video.width) / Double(video.height)
        let textureAspect = Double(texture.width) / Double(texture.height)
        var fittedWidth = Double(texture.width)
        var fittedHeight = Double(texture.height)
        if videoAspect > textureAspect {
            fittedHeight = fittedWidth / videoAspect
        } else if videoAspect < textureAspect {
            fittedWidth = fittedHeight * videoAspect
        }

        let width = max(2, Int(fittedWidth.rounded(.down)) & ~1)
        let height = max(2, Int(fittedHeight.rounded(.down)) & ~1)
        guard width <= texture.width, height <= texture.height else { return whole }

        return (
            origin: MTLOrigin(x: (texture.width - width) / 2, y: (texture.height - height) / 2, z: 0),
            size: MTLSize(width: width, height: height, depth: 1)
        )
    }

    private func enqueueSampleBuffer(
        for pixelBuffer: CVPixelBuffer,
        clock: ConduitPipPlaybackClockSnapshot
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

        let positionSeconds = clock.interpolatedPositionSeconds(
            at: ProcessInfo.processInfo.systemUptime
        )
        let presentationTime = positionSeconds.isFinite && positionSeconds >= 0
            ? CMTime(seconds: positionSeconds, preferredTimescale: 90_000)
            : CMTime(seconds: CACurrentMediaTime(), preferredTimescale: 90_000)

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

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.enqueueOnMain(sampleBuffer)
        }
    }

    private func enqueueOnMain(_ sampleBuffer: CMSampleBuffer) {
        if displayLayer.status == .failed {
            logCapture("display layer failed; flushing before retry")
            flushDisplayLayer(removeImage: true)
        }

        if #available(iOS 18.0, *) {
            let renderer = displayLayer.sampleBufferRenderer
            guard renderer.isReadyForMoreMediaData else { return }
            renderer.enqueue(sampleBuffer)
        } else {
            guard displayLayer.isReadyForMoreMediaData else { return }
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
        updateArmedState()
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
