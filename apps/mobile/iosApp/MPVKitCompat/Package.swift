// swift-tools-version:5.9

import PackageDescription

// MPVKit's upstream package bundles a second copy of the FFmpeg targets that
// KSPlayer depends on. This compatibility package keeps the MPVKit 0.39
// libmpv bridge while sharing KSPlayer's FFmpegKit dependency graph.
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
                "Libmpv",
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
            name: "Libmpv",
            url: "https://github.com/mpvkit/MPVKit/releases/download/0.39.0-n7.1.1/Libmpv.xcframework.zip",
            checksum: "81f70efbc866d84dcd9f334898d14e0407083247e35153baae7a38e5cc7f8ab0"
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
