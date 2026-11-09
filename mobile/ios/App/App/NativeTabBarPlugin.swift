import UIKit
import Capacitor

/// Native iOS-tabbalk voor Ringtools (publieke UIKit-API: `UITabBar`).
///
/// - iOS 26 en hoger: geen eigen uiterlijk ingesteld; het systeem tekent de zwevende Liquid Glass-balk.
/// - iOS 18 tot 26: standaard `UITabBarAppearance` met systeemblur (geen CSS-nabootsing).
///
/// De balk bevat uitsluitend navigatie (id, label, SF Symbol, teller). Er gaan geen gegevens van gebruikers naar native code,
/// er wordt niets opgeslagen of gelogd. De webkant bepaalt de zichtbaarheid (vergrendeld, toetsenbord, overlays); native
/// verbergt de balk bovendien zodra de app inactief wordt, zodat hij nooit boven het privacyscherm of de app-switcher staat.
/// Methoden: `update`, `setHidden`, `remove`. Gebeurtenissen: `tabSelected {id}`, `layout {height}`.
private final class RingtoolsTabBar: UITabBar {
    var onLayout: (() -> Void)?
    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }
}

@objc(NativeTabBarPlugin)
public final class NativeTabBarPlugin: CAPPlugin, CAPBridgedPlugin, UITabBarDelegate {
    public let identifier = "NativeTabBarPlugin"
    public let jsName = "NativeTabBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHidden", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private var bar: RingtoolsTabBar?
    private var ids: [String] = []
    private var signature = ""
    private var wantsHidden = true
    private var inactive = false
    private var lastHeight: CGFloat = -1
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.inactive = true
            self?.applyVisibility(animated: false)
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.inactive = false
            self?.applyVisibility(animated: false)
        })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    // MARK: - Plugin-methoden

    @objc func update(_ call: CAPPluginCall) {
        let tabs = call.getArray("tabs", JSObject.self) ?? []
        let selected = call.getString("selected")
        let tint = call.getString("tint")
        let hidden = call.getBool("hidden") ?? false
        DispatchQueue.main.async {
            guard let parent = self.bridge?.viewController?.view, !tabs.isEmpty else {
                call.reject("Geen weergave of geen tabs beschikbaar.")
                return
            }
            let bar = self.ensureBar(in: parent)
            self.configureItems(bar, tabs: tabs)
            if let selected, let index = self.ids.firstIndex(of: selected), let items = bar.items, index < items.count {
                bar.selectedItem = items[index]
            }
            if let tint, let color = UIColor(hexString: tint) { bar.tintColor = color }
            self.wantsHidden = hidden
            parent.bringSubviewToFront(bar)
            self.applyVisibility(animated: false)
            parent.layoutIfNeeded()
            call.resolve(["height": Double(self.currentHeight(bar))])
        }
    }

    @objc func setHidden(_ call: CAPPluginCall) {
        let hidden = call.getBool("hidden") ?? true
        DispatchQueue.main.async {
            self.wantsHidden = hidden
            self.applyVisibility(animated: true)
            call.resolve()
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.bar?.removeFromSuperview()
            self.bar = nil
            self.ids = []
            self.signature = ""
            self.lastHeight = -1
            call.resolve()
        }
    }

    // MARK: - Opbouw

    private func ensureBar(in parent: UIView) -> RingtoolsTabBar {
        if let bar, bar.superview === parent { return bar }
        bar?.removeFromSuperview()
        let bar = RingtoolsTabBar()
        bar.delegate = self
        bar.translatesAutoresizingMaskIntoConstraints = false
        if #unavailable(iOS 26.0) {
            // Vóór iOS 26: standaard systeemblur. Op iOS 26 blijft het uiterlijk volledig aan het systeem (Liquid Glass).
            let appearance = UITabBarAppearance()
            appearance.configureWithDefaultBackground()
            bar.standardAppearance = appearance
            bar.scrollEdgeAppearance = appearance
        }
        bar.onLayout = { [weak self, weak bar] in
            guard let self, let bar else { return }
            let height = self.currentHeight(bar)
            if abs(height - self.lastHeight) > 0.5 {
                self.lastHeight = height
                self.notifyListeners("layout", data: ["height": Double(height)])
            }
        }
        parent.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: parent.bottomAnchor)
        ])
        self.bar = bar
        self.signature = ""
        return bar
    }

    private func configureItems(_ bar: UITabBar, tabs: [JSObject]) {
        let parsed: [(id: String, label: String, symbol: String, badge: Int, a11y: String)] = tabs.compactMap { tab in
            guard let id = tab["id"] as? String, let label = tab["label"] as? String else { return nil }
            return (id, label, (tab["symbol"] as? String) ?? "circle", (tab["badge"] as? Int) ?? 0, (tab["a11y"] as? String) ?? label)
        }
        let newSignature = parsed.map { "\($0.id)|\($0.label)|\($0.symbol)" }.joined(separator: ";")
        if newSignature != signature {
            signature = newSignature
            ids = parsed.map { $0.id }
            bar.items = parsed.enumerated().map { index, tab in
                let image = UIImage(systemName: tab.symbol) ?? UIImage(systemName: "circle")
                let selectedImage = UIImage(systemName: tab.symbol + ".fill") ?? image
                let item = UITabBarItem(title: tab.label, image: image, selectedImage: selectedImage)
                item.tag = index
                item.accessibilityIdentifier = "tab-\(tab.id)"
                return item
            }
        }
        // Tellers en toegankelijkheidslabels mogen elke update wijzigen zonder de balk opnieuw op te bouwen.
        for (index, tab) in parsed.enumerated() {
            guard let item = bar.items?[index] else { continue }
            item.badgeValue = tab.badge > 0 ? (tab.badge > 99 ? "99+" : String(tab.badge)) : nil
            item.accessibilityLabel = tab.a11y
        }
    }

    private func currentHeight(_ bar: UIView) -> CGFloat {
        guard let parent = bar.superview, !bar.isHidden else { return 0 }
        return max(0, parent.bounds.height - bar.frame.minY)
    }

    private func applyVisibility(animated: Bool) {
        guard let bar else { return }
        let shouldHide = wantsHidden || inactive
        if shouldHide == bar.isHidden && (shouldHide || bar.alpha == 1) { notifyHeight(); return }
        if animated && !inactive {
            if !shouldHide { bar.isHidden = false; bar.alpha = 0 }
            UIView.animate(withDuration: 0.2, animations: { bar.alpha = shouldHide ? 0 : 1 }, completion: { _ in
                bar.isHidden = shouldHide
                self.notifyHeight()
            })
        } else {
            bar.alpha = shouldHide ? 0 : 1
            bar.isHidden = shouldHide
            notifyHeight()
        }
    }

    private func notifyHeight() {
        guard let bar else { return }
        let height = currentHeight(bar)
        if abs(height - lastHeight) > 0.5 {
            lastHeight = height
            notifyListeners("layout", data: ["height": Double(height)])
        }
    }

    // MARK: - UITabBarDelegate

    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard item.tag >= 0, item.tag < ids.count else { return }
        notifyListeners("tabSelected", data: ["id": ids[item.tag]])
    }
}

private extension UIColor {
    /// "#rrggbb" → UIColor; ongeldige invoer geeft nil (de systeemkleur blijft dan staan).
    convenience init?(hexString: String) {
        var value = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let number = UInt32(value, radix: 16) else { return nil }
        self.init(red: CGFloat((number >> 16) & 0xff) / 255, green: CGFloat((number >> 8) & 0xff) / 255, blue: CGFloat(number & 0xff) / 255, alpha: 1)
    }
}
