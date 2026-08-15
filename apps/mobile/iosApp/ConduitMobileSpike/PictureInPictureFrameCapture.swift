import AVFoundation
import CoreMedia
import Metal

struct ConduitPipPlaybackClockSnapshot: Equatable {
    let positionMs: Int64
    let durationMs: Int64
    let isPlaying: Bool
    let playbackRate: Double
    let videoFrameRate: Double
    let generation: UInt64

    static let empty = ConduitPipPlaybackClockSnapshot(
        positionMs: 0,
        durationMs: 0,
        isPlaying: false,
        playbackRate: 1,
        videoFrameRate: 30,
        generation: 0
    )
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
        value = ConduitPipPlaybackClockSnapshot(
            positionMs: max(positionMs, 0),
            durationMs: max(durationMs, 0),
            isPlaying: isPlaying,
            playbackRate: playbackRate > 0 ? playbackRate : 1,
            videoFrameRate: videoFrameRate > 0 ? videoFrameRate : 30,
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

struct ConduitPipFrameScheduler {
    private(set) var lastCaptureUptime: TimeInterval = 0
    private(set) var lastPresentationID: UInt64 = 0

    mutating func reset() {
        lastCaptureUptime = 0
        lastPresentationID = 0
    }

    mutating func shouldCapture(
        at uptime: TimeInterval,
        presentationID: UInt64,
        clock: ConduitPipPlaybackClockSnapshot
    ) -> Bool {
        guard presentationID != lastPresentationID else { return false }

        let frameRate = min(max(clock.videoFrameRate > 0 ? clock.videoFrameRate : 30, 1), 60)
        let playbackRate = min(max(clock.playbackRate > 0 ? clock.playbackRate : 1, 0.25), 4)
        let effectiveFrameRate = min(frameRate * playbackRate, 60)
        let minimumInterval = 1 / effectiveFrameRate
        guard lastCaptureUptime == 0 || uptime - lastCaptureUptime >= minimumInterval else {
            return false
        }

        lastCaptureUptime = uptime
        lastPresentationID = presentationID
        return true
    }
}

struct ConduitPipTimestampEstimator {
    private(set) var lastTimestamp = CMTime.invalid

    private var generation: UInt64?
    private var anchorPositionMs: Int64 = 0
    private var anchorUptime: TimeInterval = 0
    private var anchorIsPlaying = false
    private var anchorRate = 1.0

    mutating func reset() {
        lastTimestamp = .invalid
        generation = nil
        anchorPositionMs = 0
        anchorUptime = 0
        anchorIsPlaying = false
        anchorRate = 1
    }

    mutating func timestamp(
        for clock: ConduitPipPlaybackClockSnapshot,
        at uptime: TimeInterval
    ) -> CMTime {
        let predictedPositionMs = anchorPositionMs + Int64(
            max(0, uptime - anchorUptime) * 1_000 * anchorRate
        )
        let generationChanged = generation != clock.generation
        let needsNewAnchor = generation != clock.generation
            || anchorUptime == 0
            || anchorIsPlaying != clock.isPlaying
            || abs(clock.playbackRate - anchorRate) > 0.01
            || abs(clock.positionMs - predictedPositionMs) > 750

        if needsNewAnchor {
            if generationChanged {
                lastTimestamp = .invalid
            }
            generation = clock.generation
            anchorPositionMs = max(clock.positionMs, 0)
            anchorUptime = uptime
            anchorIsPlaying = clock.isPlaying
            anchorRate = min(max(clock.playbackRate > 0 ? clock.playbackRate : 1, 0.25), 4)
        }

        let elapsedMs = anchorIsPlaying
            ? Int64(max(0, uptime - anchorUptime) * 1_000 * anchorRate)
            : 0
        let positionMs = max(anchorPositionMs + elapsedMs, 0)
        var timestamp = CMTime(value: positionMs, timescale: 1_000)

        if lastTimestamp.isValid && CMTimeCompare(timestamp, lastTimestamp) <= 0 {
            timestamp = CMTimeAdd(lastTimestamp, CMTime(value: 1, timescale: 1_000))
        }

        lastTimestamp = timestamp
        return timestamp
    }
}

/// Copies presented MPV textures into IOSurface-backed sample buffers without
/// involving Core Image or the main thread's render loop.
final class ConduitPictureInPictureFrameCapture {
    typealias ClockProvider = () -> ConduitPipPlaybackClockSnapshot
    typealias FrameEnqueuedHandler = () -> Void

    private let metalLayer: ConduitMetalLayer
    private weak var displayLayer: AVSampleBufferDisplayLayer?
    private let clockProvider: ClockProvider
    private var onFrameEnqueued: FrameEnqueuedHandler
    private let captureQueue = DispatchQueue(
        label: "media.conduit.pip-frame-capture",
        qos: .userInitiated
    )
    private var commandQueue: MTLCommandQueue?
    private var textureCache: CVMetalTextureCache?
    private let stateLock = NSLock()

    private var isArmed = false
    private var generation: UInt64 = 0
    private var inFlightGeneration: UInt64?

    private var scheduler = ConduitPipFrameScheduler()
    private var timestampEstimator = ConduitPipTimestampEstimator()
    private var pixelBufferPool: CVPixelBufferPool?
    private var formatDescription: CMVideoFormatDescription?
    private var poolSize = CGSize.zero
    private var destinationPixelFormat: MTLPixelFormat = .bgra8Unorm

    init(
        metalLayer: ConduitMetalLayer,
        displayLayer: AVSampleBufferDisplayLayer,
        clockProvider: @escaping ClockProvider,
        onFrameEnqueued: @escaping FrameEnqueuedHandler
    ) {
        self.metalLayer = metalLayer
        self.displayLayer = displayLayer
        self.clockProvider = clockProvider
        self.onFrameEnqueued = onFrameEnqueued
    }

    func setOnFrameEnqueued(_ handler: @escaping FrameEnqueuedHandler) {
        onFrameEnqueued = handler
    }

    func start() {
        stateLock.lock()
        generation &+= 1
        isArmed = true
        stateLock.unlock()

        captureQueue.async { [weak self] in
            guard let self else { return }
            self.scheduler.reset()
            self.timestampEstimator.reset()
            self.clearPool()
        }
    }

    func stop() {
        stateLock.lock()
        generation &+= 1
        isArmed = false
        stateLock.unlock()

        captureQueue.async { [weak self] in
            guard let self else { return }
            self.scheduler.reset()
            self.timestampEstimator.reset()
            self.clearPool()
        }
    }

    func resetTimeline() {
        stateLock.lock()
        generation &+= 1
        stateLock.unlock()

        captureQueue.async { [weak self] in
            guard let self else { return }
            self.scheduler.reset()
            self.timestampEstimator.reset()
            self.clearPool()
        }
    }

    func handlePresentedDrawable(_ drawable: CAMetalDrawable, presentationID: UInt64) {
        let clock = clockProvider()

        stateLock.lock()
        guard isArmed, inFlightGeneration == nil else {
            stateLock.unlock()
            return
        }
        let captureGeneration = generation
        inFlightGeneration = captureGeneration
        stateLock.unlock()

        captureQueue.async { [weak self] in
            guard let self else { return }
            guard self.isCurrentGeneration(captureGeneration) else {
                self.finishCapture(for: captureGeneration)
                return
            }
            self.capture(
                drawable: drawable,
                presentationID: presentationID,
                clock: clock,
                generation: captureGeneration
            )
        }
    }

    private func capture(
        drawable: CAMetalDrawable,
        presentationID: UInt64,
        clock: ConduitPipPlaybackClockSnapshot,
        generation: UInt64
    ) {
        guard isCurrentGeneration(generation), let displayLayer else {
            finishCapture(for: generation)
            return
        }
        if displayLayer.status == .failed { displayLayer.flush() }
        guard displayLayer.isReadyForMoreMediaData,
              scheduler.shouldCapture(
                  at: ProcessInfo.processInfo.systemUptime,
                  presentationID: presentationID,
                  clock: clock
              )
        else {
            finishCapture(for: generation)
            return
        }

        let sourceTexture = drawable.texture
        guard let destinationFormat = Self.destinationFormat(for: sourceTexture.pixelFormat),
              sourceTexture.width > 1,
              sourceTexture.height > 1,
              ensureMetalResources(),
              ensurePool(
                  width: sourceTexture.width,
                  height: sourceTexture.height,
                  pixelFormat: destinationFormat
              ),
              let pixelBufferPool,
              let textureCache,
              let commandQueue,
              let formatDescription
        else {
            finishCapture(for: generation)
            return
        }

        var pixelBuffer: CVPixelBuffer?
        let allocationAttributes: CFDictionary = [
            kCVPixelBufferPoolAllocationThresholdKey: 4,
        ] as CFDictionary
        guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(
            nil,
            pixelBufferPool,
            allocationAttributes,
            &pixelBuffer
        ) == kCVReturnSuccess,
              let pixelBuffer
        else {
            finishCapture(for: generation)
            return
        }

        var destinationTexture: CVMetalTexture?
        guard CVMetalTextureCacheCreateTextureFromImage(
            nil,
            textureCache,
            pixelBuffer,
            nil,
            destinationFormat,
            sourceTexture.width,
            sourceTexture.height,
            0,
            &destinationTexture
        ) == kCVReturnSuccess,
              let destinationTexture,
              let texture = CVMetalTextureGetTexture(destinationTexture),
              texture.width == sourceTexture.width,
              texture.height == sourceTexture.height,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let blit = commandBuffer.makeBlitCommandEncoder()
        else {
            finishCapture(for: generation)
            return
        }

        blit.copy(
            from: sourceTexture,
            sourceSlice: 0,
            sourceLevel: 0,
            sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
            sourceSize: MTLSize(width: sourceTexture.width, height: sourceTexture.height, depth: 1),
            to: texture,
            destinationSlice: 0,
            destinationLevel: 0,
            destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
        )
        blit.endEncoding()

        let timestamp = timestampEstimator.timestamp(
            for: clock,
            at: ProcessInfo.processInfo.systemUptime
        )
        let duration = CMTimeMakeWithSeconds(
            1 / min(max(clock.videoFrameRate > 0 ? clock.videoFrameRate : 30, 1), 60),
            preferredTimescale: 600
        )

        commandBuffer.addCompletedHandler { [weak self] commandBuffer in
            guard let self else { return }
            self.captureQueue.async {
                guard self.isCurrentGeneration(generation),
                      commandBuffer.status == .completed,
                      let displayLayer = self.displayLayer
                else {
                    self.finishCapture(for: generation)
                    return
                }

                var timing = CMSampleTimingInfo(
                    duration: duration,
                    presentationTimeStamp: timestamp,
                    decodeTimeStamp: .invalid
                )
                var sample: CMSampleBuffer?
                guard CMSampleBufferCreateReadyWithImageBuffer(
                    allocator: kCFAllocatorDefault,
                    imageBuffer: pixelBuffer,
                    formatDescription: formatDescription,
                    sampleTiming: &timing,
                    sampleBufferOut: &sample
                ) == noErr,
                let sample
                else {
                    self.finishCapture(for: generation)
                    return
                }

                if displayLayer.status == .failed {
                    displayLayer.flush()
                }
                guard displayLayer.isReadyForMoreMediaData else {
                    self.finishCapture(for: generation)
                    return
                }

                displayLayer.enqueue(sample)
                self.onFrameEnqueued()
                self.finishCapture(for: generation)
            }
        }
        commandBuffer.commit()
    }

    private func ensurePool(width: Int, height: Int, pixelFormat: MTLPixelFormat) -> Bool {
        let size = CGSize(width: width, height: height)
        guard poolSize != size || destinationPixelFormat != pixelFormat else { return true }
        guard let pixelFormatType = Self.pixelBufferFormat(for: pixelFormat) else { return false }

        let poolAttributes: [CFString: Any] = [
            kCVPixelBufferPoolMinimumBufferCountKey: 4,
        ]
        let pixelBufferAttributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: pixelFormatType,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
            kCVPixelBufferMetalCompatibilityKey: true,
        ]

        var pool: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(
            nil,
            poolAttributes as CFDictionary,
            pixelBufferAttributes as CFDictionary,
            &pool
        ) == kCVReturnSuccess,
        let pool
        else { return false }

        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
              let buffer
        else { return false }

        var description: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: buffer,
            formatDescriptionOut: &description
        ) == noErr,
        let description
        else { return false }

        pixelBufferPool = pool
        formatDescription = description
        poolSize = size
        destinationPixelFormat = pixelFormat
        displayLayer?.flush()
        if let textureCache { CVMetalTextureCacheFlush(textureCache, 0) }
        return true
    }

    private func clearPool() {
        pixelBufferPool = nil
        formatDescription = nil
        poolSize = .zero
        destinationPixelFormat = .bgra8Unorm
        if let textureCache { CVMetalTextureCacheFlush(textureCache, 0) }
    }

    private func ensureMetalResources() -> Bool {
        guard let device = metalLayer.device else { return false }

        if commandQueue == nil {
            commandQueue = device.makeCommandQueue()
        }
        if textureCache == nil {
            var cache: CVMetalTextureCache?
            CVMetalTextureCacheCreate(nil, nil, device, nil, &cache)
            textureCache = cache
        }
        return commandQueue != nil && textureCache != nil
    }

    private func finishCapture(for candidate: UInt64) {
        stateLock.lock()
        if inFlightGeneration == candidate {
            inFlightGeneration = nil
        }
        stateLock.unlock()
    }

    private func isCurrentGeneration(_ candidate: UInt64) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return isArmed && generation == candidate
    }

    private static func destinationFormat(for sourceFormat: MTLPixelFormat) -> MTLPixelFormat? {
        switch sourceFormat {
        case .rgba16Float:
            return .rgba16Float
        case .bgra8Unorm, .bgra8Unorm_srgb:
            return sourceFormat
        default:
            return nil
        }
    }

    private static func pixelBufferFormat(for metalFormat: MTLPixelFormat) -> OSType? {
        switch metalFormat {
        case .rgba16Float:
            return kCVPixelFormatType_64RGBAHalf
        case .bgra8Unorm, .bgra8Unorm_srgb:
            return kCVPixelFormatType_32BGRA
        default:
            return nil
        }
    }
}
