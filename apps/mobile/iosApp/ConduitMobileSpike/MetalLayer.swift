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
    private var latestDrawable: CAMetalDrawable?
    private lazy var captureContext = device.map(CIContext.init(mtlDevice:))

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
    func copyLatestFrame(to pixelBuffer: CVPixelBuffer) -> Bool {
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
        let scaledImage = image.transformed(by: CGAffineTransform(
            scaleX: targetSize.width / image.extent.width,
            y: targetSize.height / image.extent.height
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
