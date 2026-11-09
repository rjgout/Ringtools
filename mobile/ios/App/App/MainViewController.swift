import UIKit
import Capacitor

/// Brug-controller van de app. Registreert de eigen (lokale) plug-in voor de native tabbalk; alle andere plug-ins
/// worden door Capacitor zelf geladen (CapApp-SPM).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeTabBarPlugin())
    }
}
