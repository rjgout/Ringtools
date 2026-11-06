// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.0"),
        .package(name: "AparajitaCapacitorBiometricAuth", path: "../../../node_modules/@aparajita/capacitor-biometric-auth"),
        .package(name: "AparajitaCapacitorSecureStorage", path: "../../../node_modules/@aparajita/capacitor-secure-storage"),
        .package(name: "CapacitorCommunityPrivacyScreen", path: "../../../node_modules/@capacitor-community/privacy-screen"),
        .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
        .package(name: "CapacitorKeyboard", path: "../../../node_modules/@capacitor/keyboard"),
        .package(name: "CapacitorNetwork", path: "../../../node_modules/@capacitor/network"),
        .package(name: "CapacitorPushNotifications", path: "../../../node_modules/@capacitor/push-notifications"),
        .package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share"),
        .package(name: "CapacitorSplashScreen", path: "../../../node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../node_modules/@capacitor/status-bar"),
        .package(name: "CapawesomeCapacitorPasskeys", path: "../../../node_modules/@capawesome/capacitor-passkeys"),
        .package(name: "PerfoodCapacitorCryptoApi", path: "../../../node_modules/@perfood/capacitor-crypto-api")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "AparajitaCapacitorBiometricAuth", package: "AparajitaCapacitorBiometricAuth"),
                .product(name: "AparajitaCapacitorSecureStorage", package: "AparajitaCapacitorSecureStorage"),
                .product(name: "CapacitorCommunityPrivacyScreen", package: "CapacitorCommunityPrivacyScreen"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorKeyboard", package: "CapacitorKeyboard"),
                .product(name: "CapacitorNetwork", package: "CapacitorNetwork"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapawesomeCapacitorPasskeys", package: "CapawesomeCapacitorPasskeys"),
                .product(name: "PerfoodCapacitorCryptoApi", package: "PerfoodCapacitorCryptoApi")
            ]
        )
    ]
)
