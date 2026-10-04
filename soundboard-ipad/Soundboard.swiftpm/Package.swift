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
            name: "Dungeon Radio",
            targets: ["AppModule"],
            // Kept from when the app was called Soundboard, so installed copies
            // update in place and keep their sounds.
            bundleIdentifier: "com.local.soundboard",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .asset("AppIcon"),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ],
            capabilities: [
                .localNetwork(
                    purposeString: "Dungeon Radio uses your local network to find and host Live Sessions with other players at the table.",
                    bonjourServiceTypes: ["_dungeonradio._tcp"]
                )
            ],
            // Background audio: sounds keep playing with the screen locked or in another app.
            additionalInfoPlistContentFilePath: "BackgroundAudio.plist"
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: ".",
            exclude: ["BackgroundAudio.plist"],
            resources: [
                .process("Resources")
            ]
        )
    ]
)
