import Metal
import UIKit

/// A small CAMetalLayer adapter for MPVKit's iOS MoltenVK video output.
///
/// MPV can touch the layer from its video-output thread, while UIKit expects
/// EDR configuration on the main thread. Keeping that detail here avoids
/// leaking rendering concerns into the Compose player contract.
///
/// The layer also owns the two PiP capture hooks:
///
/// - Foreground capture registers a presented handler so the blit reads a
///   drawable only after Core Animation has shown it.
/// - Background capture (`capturesWithoutPresentation`) hands the previous
///   drawable to the capture synchronously at acquire time, because Core
///   Animation stops firing presented handlers once the app backgrounds.
final class ConduitMetalLayer: CAMetalLayer {
    private static let failureThresholdBeforeSuspension = 2
    private static let suspendedRetryInterval: CFTimeInterval = 1.0
    private static let suspendedIdleSleep: TimeInterval = 0.03

    private let captureLock = NSLock()
    private let heartbeatLock = NSLock()
    private let resizeLock = NSLock()

    private var drawableHeartbeat: UInt64 = 0
    private var lastDrawableUptime: TimeInterval = 0
    private var liveResize = false

    private var drawableCaptureArmed = false
    private var captureWithoutPresentation = false
    private var presentationID: UInt64 = 0
    private var latestDrawableTexture: (texture: MTLTexture, presentationID: UInt64)?
    private var pendingDrawable: (drawable: CAMetalDrawable, presentationID: UInt64)?

    private var renderingSuspended = false
    private var consecutiveAcquisitionFailures = 0
    private var lastSuspendedProbeTime: CFTimeInterval = 0

    var onDrawablePresented: ((MTLTexture, UInt64, AnyObject?) -> Void)? {
        get {
            captureLock.lock()
            defer { captureLock.unlock() }
            return drawablePresentationHandler
        }
        set {
            captureLock.lock()
            drawablePresentationHandler = newValue
            captureLock.unlock()
        }
    }

    var onRenderingSuspensionChanged: ((Bool) -> Void)?

    private var drawablePresentationHandler: ((MTLTexture, UInt64, AnyObject?) -> Void)?

    @objc dynamic var isDrawableCaptureArmed: Bool {
        get {
            captureLock.lock()
            defer { captureLock.unlock() }
            return drawableCaptureArmed
        }
        set {
            captureLock.lock()
            drawableCaptureArmed = newValue
            captureLock.unlock()
        }
    }

    /// When true, capture consumes drawables at acquire time instead of
    /// waiting for a presented handler that never fires while backgrounded.
    /// This is read by this class's own nextDrawable override; MPVKit does
    /// not need to know about it.
    @objc dynamic var capturesWithoutPresentation: Bool {
        get {
            captureLock.lock()
            defer { captureLock.unlock() }
            return captureWithoutPresentation
        }
        set {
            captureLock.lock()
            captureWithoutPresentation = newValue
            captureLock.unlock()
        }
    }

    /// MPVKit's MoltenVK bridge checks this selector before rebuilding its
    /// swapchain. Keep it thread-safe because MPV reads it off the main queue.
    @objc dynamic var isNuvioLiveResize: Bool {
        get {
            resizeLock.lock()
            defer { resizeLock.unlock() }
            return liveResize
        }
        set {
            resizeLock.lock()
            liveResize = newValue
            resizeLock.unlock()
        }
    }

    var isSuspended: Bool {
        captureLock.lock()
        defer { captureLock.unlock() }
        return renderingSuspended
    }

    override var drawableSize: CGSize {
        get { super.drawableSize }
        set {
            guard newValue.width > 1, newValue.height > 1 else { return }
            super.drawableSize = newValue
        }
    }

    /// PiP reads the final drawable as a blit source. MPVKit's MoltenVK setup
    /// enables framebufferOnly for normal presentation, which would make that
    /// texture unavailable to the capture path. Keep it shader/blit-readable.
    override var framebufferOnly: Bool {
        get { super.framebufferOnly }
        set { super.framebufferOnly = false }
    }

    /// Stops handing drawables to MoltenVK's swapchain loop when acquisition
    /// keeps failing (for example while backgrounded without PiP). While
    /// suspended, nextDrawable sleeps briefly and returns nil, probing the
    /// real swapchain once per second until an acquire succeeds again.
    func setRenderingSuspended(_ suspended: Bool, reason: String) {
        captureLock.lock()
        let changed = renderingSuspended != suspended
        renderingSuspended = suspended
        consecutiveAcquisitionFailures = 0
        lastSuspendedProbeTime = suspended ? CACurrentMediaTime() : 0
        let stale = pendingDrawable
        pendingDrawable = nil
        captureLock.unlock()

        withExtendedLifetime(stale) {}
        if changed {
            #if DEBUG
            print("[Conduit PiP] rendering suspension \(suspended ? "on" : "off") reason=\(reason)")
            #endif
            onRenderingSuspensionChanged?(suspended)
        }
    }

    func releasePendingDrawable() {
        captureLock.lock()
        let stale = pendingDrawable
        pendingDrawable = nil
        captureLock.unlock()
        withExtendedLifetime(stale) {}
    }

    override func nextDrawable() -> CAMetalDrawable? {
        captureLock.lock()
        if renderingSuspended {
            let now = CACurrentMediaTime()
            let shouldProbe = now - lastSuspendedProbeTime >= Self.suspendedRetryInterval
            if shouldProbe { lastSuspendedProbeTime = now }
            let stale = pendingDrawable
            pendingDrawable = nil
            captureLock.unlock()
            withExtendedLifetime(stale) {}
            guard shouldProbe else {
                Thread.sleep(forTimeInterval: Self.suspendedIdleSleep)
                return nil
            }
        } else {
            captureLock.unlock()
        }

        let drawable = super.nextDrawable()
        if drawable != nil {
            heartbeatLock.lock()
            drawableHeartbeat &+= 1
            lastDrawableUptime = ProcessInfo.processInfo.systemUptime
            heartbeatLock.unlock()
        }

        captureLock.lock()
        var didSuspend = false
        if let drawable {
            consecutiveAcquisitionFailures = 0
            presentationID &+= 1
            latestDrawableTexture = (drawable.texture, presentationID)
        } else {
            consecutiveAcquisitionFailures += 1
            if !renderingSuspended,
               consecutiveAcquisitionFailures >= Self.failureThresholdBeforeSuspension {
                renderingSuspended = true
                lastSuspendedProbeTime = CACurrentMediaTime()
                didSuspend = true
            }
        }

        let suspendedNow = renderingSuspended
        let armed = drawableCaptureArmed
        let handler = drawablePresentationHandler
        let deferred = captureWithoutPresentation && !suspendedNow
        let previous = pendingDrawable
        if let drawable {
            pendingDrawable = deferred ? (drawable, presentationID) : nil
        } else if !deferred {
            pendingDrawable = nil
        }
        let currentPresentationID = presentationID
        captureLock.unlock()

        if didSuspend { onRenderingSuspensionChanged?(true) }

        guard !suspendedNow else { return drawable }
        guard armed, let drawable, let handler else { return drawable }

        if deferred {
            // Backgrounded: Core Animation will never present, so hand the
            // previously acquired drawable to capture right away instead of
            // registering a presented handler that would never fire.
            if let previous {
                handler(previous.drawable.texture, previous.presentationID, previous.drawable)
            }
            return drawable
        }

        // MTLDrawable's presented handler runs after MPV's command buffer has
        // presented the texture. Read its texture before registering the
        // callback; asking a presented CAMetalDrawable for its texture is
        // invalid and produces a Metal warning on the first PiP transition.
        let sourceTexture = drawable.texture
        let registered = ConduitAddMetalDrawablePresentedHandler(drawable) { _ in
            handler(sourceTexture, currentPresentationID, drawable)
        }
        if !registered {
            // The iOS simulator SDK currently omits the presentation
            // handler requirement even though device Metal supports it.
            // Keep simulator playback usable with a bounded fallback.
            handler(sourceTexture, currentPresentationID, drawable)
        }
        return drawable
    }

    /// PiP priming can begin between two MPV presents (for example while
    /// paused). Keep one acquired texture around until the capture
    /// coordinator has had a chance to consume it. Retaining the texture does
    /// not hold a CAMetalDrawable in the swapchain, so normal playback can
    /// continue without extra backpressure.
    func latestDrawableTextureSnapshot() -> (texture: MTLTexture, presentationID: UInt64)? {
        captureLock.lock()
        defer { captureLock.unlock() }
        return latestDrawableTexture
    }

    /// Returns the last successful drawable acquisition without exposing the
    /// drawable itself to the player watchdog.
    func drawableHeartbeatSnapshot() -> (count: UInt64, uptime: TimeInterval) {
        heartbeatLock.lock()
        defer { heartbeatLock.unlock() }
        return (drawableHeartbeat, lastDrawableUptime)
    }

    @available(iOS 16.0, *)
    override var wantsExtendedDynamicRangeContent: Bool {
        get { super.wantsExtendedDynamicRangeContent }
        set {
            if Thread.isMainThread {
                super.wantsExtendedDynamicRangeContent = newValue
            } else {
                DispatchQueue.main.async { [weak self] in
                    self?.wantsExtendedDynamicRangeContent = newValue
                }
            }
        }
    }
}
