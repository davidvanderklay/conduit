import Metal
import UIKit

/// A small CAMetalLayer adapter for MPVKit's iOS MoltenVK video output.
///
/// MPV can touch the layer from its video-output thread, while UIKit expects
/// EDR configuration on the main thread. Keeping that detail here avoids
/// leaking rendering concerns into the Compose player contract.
final class ConduitMetalLayer: CAMetalLayer {
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

    var onDrawablePresented: ((CAMetalDrawable, UInt64) -> Void)? {
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

    private var drawablePresentationHandler: ((CAMetalDrawable, UInt64) -> Void)?

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

    /// Consumed by an MPVKit build that explicitly supports background
    /// rendering without a normal layer presentation. The pinned MPVKit
    /// revision does not read this selector yet.
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

    override func nextDrawable() -> CAMetalDrawable? {
        let drawable = super.nextDrawable()
        if drawable != nil {
            heartbeatLock.lock()
            drawableHeartbeat &+= 1
            lastDrawableUptime = ProcessInfo.processInfo.systemUptime
            heartbeatLock.unlock()
        }
        captureLock.lock()
        if let drawable {
            presentationID &+= 1
            latestDrawableTexture = (drawable.texture, presentationID)
        }
        let shouldCapture = drawableCaptureArmed && drawable != nil
        let currentPresentationID = presentationID
        let handler = drawablePresentationHandler
        captureLock.unlock()

        // MTLDrawable's presented handler runs after MPV's command buffer has
        // presented the texture. This avoids copying while MoltenVK is still
        // rendering into the drawable returned by nextDrawable().
        if shouldCapture, let drawable, let handler {
            let registered = ConduitAddMetalDrawablePresentedHandler(drawable) { presentedDrawable in
                guard let drawable = presentedDrawable as? CAMetalDrawable else { return }
                handler(drawable, currentPresentationID)
            }
            if !registered {
                // The iOS simulator SDK currently omits the presentation
                // handler requirement even though device Metal supports it.
                // Keep simulator playback usable with a bounded fallback.
                handler(drawable, currentPresentationID)
            }
        }
        return drawable
    }

    /// PiP priming can begin between two MPV presents. Keep one presented
    /// texture around until the capture coordinator has had a chance to
    /// consume it. Retaining the texture does not hold a CAMetalDrawable in
    /// the swapchain, so normal playback can continue without extra backpressure.
    func latestDrawableTextureSnapshot() -> (texture: MTLTexture, presentationID: UInt64)? {
        captureLock.lock()
        defer { captureLock.unlock() }
        return latestDrawableTexture
    }

    func discardLatestDrawableTexture(upTo presentationID: UInt64) {
        captureLock.lock()
        if latestDrawableTexture?.presentationID ?? 0 <= presentationID {
            latestDrawableTexture = nil
        }
        captureLock.unlock()
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
