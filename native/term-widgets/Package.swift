// swift-tools-version: 5.9
// Term's widget bridge, a local Capacitor plugin (package.json: "term-widgets": "file:native/term-widgets").
import PackageDescription

let package = Package(
    name: "TermWidgets",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "TermWidgets", targets: ["TermWidgetsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "TermWidgetsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/TermWidgetsPlugin")
    ]
)
