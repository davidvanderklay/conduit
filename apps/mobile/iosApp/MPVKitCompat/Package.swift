// swift-tools-version:5.9

import PackageDescription

// Keep the legacy libmpv fallback on the same FFmpeg build as KSPlayer. The
// standalone MPVKit binary was built against a different libavcodec major
// version, which is not safe to combine with the app's shared FFmpeg targets.
let package = Package(
    name: "MPVKit",
    platforms: [.iOS(.v14), .tvOS(.v14), .macOS(.v11)],
    products: [
        .library(name: "MPVKit", targets: ["_MPVKit"]),
    ],
    dependencies: [
        .package(url: "https://github.com/kingslay/FFmpegKit.git", from: "6.1.4"),
    ],
    targets: [
        .target(
            name: "_MPVKit",
            dependencies: [
                .product(name: "libmpv", package: "FFmpegKit"),
                "MPVLibbluray",
                "Libuchardet",
                .product(name: "FFmpegKit", package: "FFmpegKit"),
            ],
            path: "Sources/_MPVKit",
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreAudio"),
            ]
        ),
        .binaryTarget(
            name: "MPVLibbluray",
            url: "https://github.com/mpvkit/libbluray-build/releases/download/1.3.4/Libbluray.xcframework.zip",
            checksum: "68540747670e734e9b9063da3e5ccb139d34e8b40e1d5ec3177392603d93dfec"
        ),
        .binaryTarget(
            name: "Libuchardet",
            url: "https://github.com/mpvkit/libuchardet-build/releases/download/0.0.8/Libuchardet.xcframework.zip",
            checksum: "ea4f548a230a755e059144657cc9e2ff563c1cdeae03974c38f8b6e1a40303fb"
        ),
    ]
)
