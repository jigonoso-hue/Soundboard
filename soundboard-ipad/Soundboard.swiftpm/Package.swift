// swift-tools-version: 5.9

// Swift Playgrounds app package. Open this folder in Swift Playgrounds
// (iPad or Mac) or in Xcode 15+.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Soundboard",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "Soundboard",
            targets: ["AppModule"],
            bundleIdentifier: "com.local.soundboard",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: ".",
            resources: [
                .process("Resources")
            ]
        )
    ]
)
