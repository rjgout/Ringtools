import UIKit
import Capacitor

/// Brug-controller van de app. Registreert de eigen (lokale) plug-in voor de native tabbalk; alle andere plug-ins
/// worden door Capacitor zelf geladen (CapApp-SPM).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeTabBarPlugin())
        bridge?.registerPluginInstance(InstallationPlugin())
    }
}

/// Niet-geheime installatie-identiteit. Het app-private bestand verdwijnt bij verwijderen en wordt niet geback-upt;
/// achtergebleven ThisDeviceOnly-Keychaingegevens worden door de client gewist bij een nieuwe identiteit.
@objc(InstallationPlugin)
public class InstallationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InstallationPlugin"
    public let jsName = "Installation"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "identity", returnType: CAPPluginReturnPromise)]
    @objc func identity(_ call: CAPPluginCall) {
        do {
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            var file = directory.appendingPathComponent("ringtools-installation-id")
            let id: String
            if FileManager.default.fileExists(atPath: file.path) {
                id = try String(contentsOf: file, encoding: .utf8)
            } else {
                id = UUID().uuidString
                try id.write(to: file, atomically: true, encoding: .utf8)
            }
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try file.setResourceValues(values)
            call.resolve(["id": id])
        } catch { call.reject("installation-unavailable") }
    }
}
