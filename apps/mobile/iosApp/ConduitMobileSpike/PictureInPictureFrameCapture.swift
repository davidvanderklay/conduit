import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import Metal

enum ConduitPictureInPictureCapturePolicy {
    static func isArmed(
        isPriming: Bool,
        isActive: Bool,
        burstFramesRemaining: Int
    ) -> Bool {
        isPriming || isActive || burstFramesRemaining > 0
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

    /// Serializes sample preparation before it is handed to the main queue.
    /// Metal completion handlers may run concurrently, while the display
    /// layer still receives samples in the order its enqueues are scheduled.
    private let completionQueue = DispatchQueue(
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

    var isArmed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return ConduitPictureInPictureCapturePolicy.isArmed(
            isPriming: isPriming,
            isActive: isActive,
            burstFramesRemaining: burstFramesRemaining
        )
    }

    // MARK: - Arming

    /// Arms capture until the first frame lands in the display layer. A
    /// prewarm or manual start may request a few frames, but capture disarms
    /// as soon as those requests are satisfied.
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
    /// completion queue so retained frames follow any already submitted
    /// capture work.
    func submitRetainedTexture(_ texture: MTLTexture, presentationID: UInt64) {
        completionQueue.async { [self] in
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
        let shouldCapture = ConduitPictureInPictureCapturePolicy.isArmed(
            isPriming: isPriming,
            isActive: isActive,
            burstFramesRemaining: burstFramesRemaining
        )
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
        #if DEBUG
        lastClaimInterval = clock.isPlaying ? now - previousCaptureTime : 0
        previousCaptureTime = now
        #endif
        if burstFramesRemaining > 0 { burstFramesRemaining -= 1 }
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

    /// Releases a capture on paths where no completion handler will ever fire.
    private func completeCapture() {
        stateLock.lock()
        inFlightCaptures = max(0, inFlightCaptures - 1)
        stateLock.unlock()
    }

    private func enqueue(
        texture source: MTLTexture,
        sourceLifetime: AnyObject?,
        clock: ConduitPipPlaybackClockSnapshot,
        ptsSeconds: Double
    ) {
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
            completeCapture()
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
            completeCapture()
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
        commandBuffer.addCompletedHandler { [weak self, sourceLifetime] _ in
            guard let self else { return }
            #if DEBUG
            let completedAt = ProcessInfo.processInfo.systemUptime
            #endif
            self.completionQueue.async {
                #if DEBUG
                self.lastCompletionUptime = completedAt
                #endif
                self.enqueueSampleBuffer(
                    for: pixelBuffer,
                    clock: clock,
                    ptsSeconds: ptsSeconds
                )
                self.completeCapture()
            }
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

        // Match the AVFoundation/CA handoff used by Enhanced Nuvio. The
        // sample-buffer display layer is scheduled on main, while the Metal
        // copy and sample construction stay off the UI thread.
        deliverSample(sampleBuffer)
    }

    private func deliverSample(_ sampleBuffer: CMSampleBuffer) {
        DispatchQueue.main.async { [weak self] in
            self?.deliverSampleOnMain(sampleBuffer)
        }
    }

    private func deliverSampleOnMain(_ sampleBuffer: CMSampleBuffer) {
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
        let armed = ConduitPictureInPictureCapturePolicy.isArmed(
            isPriming: isPriming,
            isActive: isActive,
            burstFramesRemaining: burstFramesRemaining
        )
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
