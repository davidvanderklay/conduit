import CoreImage
import Metal
import UIKit

/// A small CAMetalLayer adapter for MPVKit's iOS MoltenVK video output.
///
/// MPV can touch the layer from its video-output thread, while UIKit expects
/// EDR configuration on the main thread. Keeping that detail here avoids
/// leaking rendering concerns into the Compose player contract.
final class ConduitMetalLayer: CAMetalLayer {
    private let captureLock = NSLock()
    private let resizeLock = NSLock()
    private var latestDrawable: CAMetalDrawable?
    private var liveResize = false
    private lazy var captureContext = device.map(CIContext.init(mtlDevice:))

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

    override func nextDrawable() -> CAMetalDrawable? {
        let drawable = super.nextDrawable()
        captureLock.lock()
        latestDrawable = drawable
        captureLock.unlock()
        return drawable
    }

    /// Copies the most recently requested MPV drawable into a pooled BGRA buffer.
    /// Capture is only called while PiP is priming or active.
    func copyLatestFrame(to pixelBuffer: CVPixelBuffer, contentSize: CGSize) -> Bool {
        captureLock.lock()
        let texture = latestDrawable?.texture
        captureLock.unlock()
        guard let texture, let captureContext,
              let image = CIImage(mtlTexture: texture, options: [.colorSpace: CGColorSpaceCreateDeviceRGB()])
        else { return false }

        let targetSize = CGSize(
            width: CVPixelBufferGetWidth(pixelBuffer),
            height: CVPixelBufferGetHeight(pixelBuffer)
        )
        // Metal textures use a lower-left origin while Core Image renders the
        // pixel buffer with a top-left origin. Flip once during the PiP copy so
        // the system window matches the inline MPV surface.
        let uprightImage = image.transformed(by: CGAffineTransform(
            a: 1,
            b: 0,
            c: 0,
            d: -1,
            tx: 0,
            ty: image.extent.height
        ))
        let sourceExtent = uprightImage.extent
        let contentAspect = contentSize.width > 1 && contentSize.height > 1
            ? contentSize.width / contentSize.height
            : sourceExtent.width / sourceExtent.height
        let sourceAspect = sourceExtent.width / sourceExtent.height
        let cropRect: CGRect
        if sourceAspect > contentAspect {
            let width = sourceExtent.height * contentAspect
            cropRect = CGRect(
                x: sourceExtent.midX - width / 2,
                y: sourceExtent.minY,
                width: width,
                height: sourceExtent.height
            )
        } else {
            let height = sourceExtent.width / contentAspect
            cropRect = CGRect(
                x: sourceExtent.minX,
                y: sourceExtent.midY - height / 2,
                width: sourceExtent.width,
                height: height
            )
        }
        let croppedImage = uprightImage
            .cropped(to: cropRect)
            .transformed(by: CGAffineTransform(translationX: -cropRect.minX, y: -cropRect.minY))
        let scaledImage = croppedImage.transformed(by: CGAffineTransform(
            scaleX: targetSize.width / cropRect.width,
            y: targetSize.height / cropRect.height
        ))
        captureContext.render(
            scaledImage,
            to: pixelBuffer,
            bounds: CGRect(origin: .zero, size: targetSize),
            colorSpace: CGColorSpaceCreateDeviceRGB()
        )
        return true
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
