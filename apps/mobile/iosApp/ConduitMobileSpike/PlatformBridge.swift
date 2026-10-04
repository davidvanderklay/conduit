import ComposeApp
import AuthenticationServices
import AVFoundation
import CryptoKit
import Foundation
import Security
import UIKit
import UniformTypeIdentifiers

/// Keeps video playback from taking exclusive ownership of the device audio
/// session. This matters on iPad, where another app can remain audible beside
/// Conduit in a multitasking window.
enum ConduitAudioSession {
    private static let mixingOptions: AVAudioSession.CategoryOptions = [.mixWithOthers]
    /// The default ~21ms IO buffer cannot absorb transient system stalls
    /// (PiP window composition, screenshot flashes) without audible
    /// underruns. 60ms of headroom is imperceptible for video playback.
    private static let ioBufferDuration: TimeInterval = 0.06

    static func configureForPlayback(_ session: AVAudioSession = AVAudioSession.sharedInstance()) throws {
        try session.setCategory(.playback, mode: .moviePlayback, options: mixingOptions)
        try session.setPreferredIOBufferDuration(ioBufferDuration)
    }

    static func activateForPlayback() throws {
        let session = AVAudioSession.sharedInstance()
        try configureForPlayback(session)
        try session.setActive(true)
    }

    static func deactivateAfterPlayback() throws {
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

final class ConduitKeychainStore: NSObject, IosSecureStoreBridge {
    private let service = "media.conduit.mobile"

    func get(key: String) -> String? {
        var query = baseQuery(key: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else {
            if status != errSecItemNotFound {
                print("[Conduit Keychain] read failed with status \(status)")
            }
            return nil
        }
        guard let data = item as? Data else {
            print("[Conduit Keychain] read returned an unexpected value")
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    func put(key: String, value: String) -> Int32 {
        let data = Data(value.utf8)
        let query = baseQuery(key: key)
        let status = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        guard status == errSecItemNotFound else { return status }

        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil)
    }

    func remove(key: String) -> Int32 {
        let status = SecItemDelete(baseQuery(key: key) as CFDictionary)
        return status == errSecItemNotFound ? errSecSuccess : status
    }

    private func baseQuery(key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}

final class ConduitOAuthBridge: NSObject, IosOAuthBridge, ASWebAuthenticationPresentationContextProviding {
    private var authenticationSession: ASWebAuthenticationSession?

    func generateVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess)
        return Data(bytes).base64URLEncodedString()
    }

    func challenge(verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
    }

    func openSystemBrowser(url: String) {
        guard let url = URL(string: url) else { return }
        let start = { [weak self] in
            guard let self else { return }
            self.authenticationSession?.cancel()
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "conduit"
            ) { [weak self] callbackURL, error in
                self?.authenticationSession = nil
                if let callbackURL {
                    IosOAuthCallbacks.shared.capture(url: callbackURL.absoluteString)
                } else if let error = error as? ASWebAuthenticationSessionError,
                          error.code != .canceledLogin {
                    print("[Conduit OAuth] authentication session failed: \(error)")
                }
            }
            session.presentationContextProvider = self
            self.authenticationSession = session
            if !session.start() {
                self.authenticationSession = nil
                print("[Conduit OAuth] authentication session could not start")
            }
        }
        if Thread.isMainThread { start() } else { DispatchQueue.main.async(execute: start) }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .windows.first { $0.isKeyWindow }
            ?? UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first
            ?? UIWindow()
    }
}

final class ConduitShareBridge: NSObject, IosShareBridge {
    func shareText(text: String) {
        let present = {
            guard let presenter = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive })?
                .windows
                .first(where: \.isKeyWindow)?
                .rootViewController
            else { return }

            let share = UIActivityViewController(
                activityItems: [text],
                applicationActivities: nil
            )
            if let popover = share.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = presenter.view.bounds
                popover.permittedArrowDirections = []
            }
            presenter.present(share, animated: true)
        }
        if Thread.isMainThread { present() } else { DispatchQueue.main.async(execute: present) }
    }
}

/// Owns the picker delegate until selection or cancellation and reads only bounded UTF-8 archives.
final class ConduitProfileFilesBridge: NSObject, IosProfileFilesBridge, UIDocumentPickerDelegate {
    private var importCompletion: ((String?, String?, String?) -> KotlinUnit)?
    private var exportCompletion: ((KotlinBoolean, String?) -> KotlinUnit)?
    private var exportURL: URL?

    private func presenter() -> UIViewController? {
        var controller = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .windows.first { $0.isKeyWindow }?.rootViewController
        while let presented = controller?.presentedViewController { controller = presented }
        return controller
    }

    func pick(completion: @escaping (String?, String?, String?) -> KotlinUnit) {
        guard importCompletion == nil, exportCompletion == nil, let presenter = presenter() else {
            _ = completion(nil, nil, "Unable to open file picker")
            return
        }
        importCompletion = completion
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json, .plainText], asCopy: true)
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    func save(name: String, contents: String, completion: @escaping (KotlinBoolean, String?) -> KotlinUnit) {
        guard importCompletion == nil, exportCompletion == nil, let presenter = presenter() else {
            _ = completion(KotlinBoolean(bool: false), "Unable to open file picker")
            return
        }
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(URL(fileURLWithPath: name).lastPathComponent)
            exportURL = url
            try Data(contents.utf8).write(to: url, options: .atomic)
            exportCompletion = completion
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            presenter.present(picker, animated: true)
        } catch {
            if let url = exportURL { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            exportURL = nil
            _ = completion(KotlinBoolean(bool: false), error.localizedDescription)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if let completion = importCompletion {
            importCompletion = nil
            guard let url = urls.first else { _ = completion(nil, nil, nil); return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let handle = try FileHandle(forReadingFrom: url)
                defer { try? handle.close() }
                let data = try handle.read(upToCount: 10 * 1024 * 1024 + 1) ?? Data()
                guard data.count <= 10 * 1024 * 1024 else {
                    _ = completion(nil, nil, "Import exceeds the 10 MiB limit")
                    return
                }
                guard let text = String(data: data, encoding: .utf8) else {
                    _ = completion(nil, nil, "Import must be UTF-8 JSON")
                    return
                }
                _ = completion(url.lastPathComponent, text, nil)
            } catch { _ = completion(nil, nil, error.localizedDescription) }
        } else { finishExport(saved: !urls.isEmpty) }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let completion = importCompletion { importCompletion = nil; _ = completion(nil, nil, nil) }
        finishExport(saved: false)
    }

    private func finishExport(saved: Bool) {
        let completion = exportCompletion
        exportCompletion = nil
        if let url = exportURL { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        exportURL = nil
        _ = completion?(KotlinBoolean(bool: saved), nil)
    }
}

enum ConduitPlatformRegistration {
    static func register() {
        IosPlatformBridgeFactory.shared.register(
            secureStore: ConduitKeychainStore(),
            oauthBridge: ConduitOAuthBridge(),
            shareBridge: ConduitShareBridge(),
            profileFiles: ConduitProfileFilesBridge()
        )
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
