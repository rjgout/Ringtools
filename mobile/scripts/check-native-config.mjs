#!/usr/bin/env node
// Controleert de native configuratie zonder native tooling: identiteit, links, privacy en geheimen.
// Draait lokaal en in CI; faalt bij een inconsistentie.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const errors = [];
const ok = (cond, msg) => cond || errors.push(msg);

// 1. Capacitor-configuratie: gebundelde assets, geen externe-websitewrapper.
const cfg = read("capacitor.config.ts");
ok(!/server\s*:\s*\{[^}]*\burl\s*:/s.test(cfg), "capacitor.config.ts mag geen server.url bevatten (geen wrapper om een externe website).");
ok(/webDir:\s*"dist"/.test(cfg), 'capacitor.config.ts: webDir moet "dist" zijn (gebundelde assets).');
ok(/allowNavigation:\s*\[\s*\]/.test(cfg), "capacitor.config.ts: allowNavigation moet leeg zijn.");

// 2. Identiteit consistent tussen config, Android en iOS.
const idDefault = /process\.env\.RINGTOOLS_APP_ID \|\| "([^"]+)"/.exec(cfg)?.[1];
const gradle = read("android/app/build.gradle");
const appIdAndroid = /applicationId "([^"]+)"/.exec(gradle)?.[1];
const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
const appIdsIos = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
ok(idDefault && appIdAndroid === idDefault, `applicationId (${appIdAndroid}) ≠ appId in capacitor.config.ts (${idDefault}).`);
ok(appIdsIos.length === 2 && appIdsIos.every((i) => i === idDefault), `iOS bundle-ID's (${appIdsIos.join(", ")}) ≠ ${idDefault}.`);

// 3. Link-domein gelijk in Android, iOS en de client-standaard.
const manifest = read("android/app/src/main/AndroidManifest.xml");
const androidHosts = [...new Set([...manifest.matchAll(/android:host="([^"]+)"/g)].map((m) => m[1]))];
const iosHosts = [...read("ios/App/App/App.entitlements").matchAll(/applinks:([^<]+)</g)].map((m) => m[1]);
const iosCredentialHosts = [...read("ios/App/App/App.entitlements").matchAll(/webcredentials:([^<]+)</g)].map((m) => m[1]);
ok(androidHosts.length === 1, `Android App Links: precies één host verwacht, gevonden: ${androidHosts.join(", ")}.`);
ok(iosHosts.length === 1 && iosHosts[0] === androidHosts[0], `iOS-host (${iosHosts}) ≠ Android-host (${androidHosts}).`);
ok(iosCredentialHosts.length === 1 && iosCredentialHosts[0] === androidHosts[0], `iOS webcredentials-host (${iosCredentialHosts}) ≠ link-host (${androidHosts}); native passkeys (C5.2) vereisen dezelfde RP-host.`);
ok(/android:autoVerify="true"/.test(manifest), "AndroidManifest: autoVerify ontbreekt.");
ok(/android:pathPrefix="\/open\/"/.test(manifest) && /android:pathPrefix="\/roepingen\/"/.test(manifest) && /android:pathPrefix="\/uitnodiging\/"/.test(manifest), "AndroidManifest: paden /open/, /roepingen/ en /uitnodiging/ ontbreken.");
ok(/android:allowBackup="false"/.test(manifest), "AndroidManifest: allowBackup moet false zijn.");
ok(/android:usesCleartextTraffic="false"/.test(manifest), "AndroidManifest: cleartext-verkeer moet uit.");
ok(/<key>aps-environment<\/key>/.test(read("ios/App/App/App.entitlements")), "iOS-entitlements: aps-environment ontbreekt.");
ok(/CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/.test(pbx), "iOS-project: CODE_SIGN_ENTITLEMENTS ontbreekt.");
ok(/<key>ITSAppUsesNonExemptEncryption<\/key>/.test(read("ios/App/App/Info.plist")), "Info.plist: ITSAppUsesNonExemptEncryption ontbreekt.");

// 3a. Appvergrendeling (E3): verplichte lokale ontgrendeling en schermbescherming.
ok(/<key>NSFaceIDUsageDescription<\/key>/.test(read("ios/App/App/Info.plist")), "Info.plist: NSFaceIDUsageDescription ontbreekt (Face ID-ontgrendeling zou crashen of niet beschikbaar zijn).");
ok(/android\.permission\.USE_BIOMETRIC/.test(manifest), "AndroidManifest: USE_BIOMETRIC ontbreekt (BiometricPrompt).");
ok(/PrivacyScreen:\s*\{[^}]*enable:\s*true/.test(cfg), "capacitor.config.ts: PrivacyScreen moet aan staan (Android FLAG_SECURE, afscherming app-switcher).");
ok(/PrivacyScreen:\s*\{[^}]*preventScreenshots:\s*false/.test(cfg), "capacitor.config.ts: PrivacyScreen.preventScreenshots moet false zijn (niet-gedocumenteerde iOS-laagtruc bewust uit).");
ok(!/^\s*(?:\/\/\s*)?"?@aparajita\/capacitor-biometric-auth"?\s*:\s*"[\^~]/m.test(read("package.json")), "package.json: biometrie-plug-in moet exact gepind zijn.");

// 3b. Personal Team-testconfiguratie (iOS): zonder Push/Associated Domains, productie-entitlements onaangetast.
const cfgBlocks = [...pbx.matchAll(/\t\t[0-9A-F]{24} \/\* ([^*]+) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;([\s\S]*?)\n\t\t\};/g)].map((m) => ({ name: m[1].trim(), body: m[2] }));
const targetBlocks = cfgBlocks.filter((b) => /INFOPLIST_FILE = App\/Info.plist/.test(b.body));
const byName = (n) => targetBlocks.find((b) => b.name === n);
ok(byName("Debug") && byName("Release") && byName("Debug-PersonalTeam"), "iOS-project: configuraties Debug, Release en Debug-PersonalTeam ontbreken.");
for (const n of ["Debug", "Release"]) ok(byName(n) && /CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/.test(byName(n).body), `iOS-configuratie ${n} moet de productie-entitlements (App/App.entitlements) behouden.`);
ok(byName("Debug-PersonalTeam") && !/CODE_SIGN_ENTITLEMENTS/.test(byName("Debug-PersonalTeam").body), "Debug-PersonalTeam mag in het project geen CODE_SIGN_ENTITLEMENTS zetten (het xcconfig maakt het leeg).");
ok(/XCConfigurationList[\s\S]*Debug-PersonalTeam/.test(pbx) && (pbx.match(/\/\* Debug-PersonalTeam \*\/,/g) || []).length === 2, "Debug-PersonalTeam moet in de configuratielijsten van project én target staan.");
const personalXc = read("ios/PersonalTeam.xcconfig");
ok(/^CODE_SIGN_ENTITLEMENTS =\s*$/m.test(personalXc), "PersonalTeam.xcconfig: CODE_SIGN_ENTITLEMENTS moet leeg zijn.");
ok(/^RINGTOOLS_BUILD_PROFILE = personal-team$/m.test(personalXc), "PersonalTeam.xcconfig: RINGTOOLS_BUILD_PROFILE = personal-team ontbreekt.");
const personalId = /^PRODUCT_BUNDLE_IDENTIFIER = (\S+)$/m.exec(personalXc)?.[1];
ok(personalId && personalId !== idDefault, "PersonalTeam.xcconfig: gebruik een afwijkende bundle-ID zodat de productie-ID niet door een Personal Team wordt geclaimd.");
ok(!/^(aps-environment|applinks|webcredentials)/m.test(personalXc), "PersonalTeam.xcconfig mag geen push/associated-domains-configuratie bevatten.");
const scheme = read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App-PersonalTeam.xcscheme");
ok(/<LaunchAction\s+buildConfiguration = "Debug-PersonalTeam"/.test(scheme) && /<ArchiveAction\s+buildConfiguration = "Release"/.test(scheme), "Scheme App-PersonalTeam: Run moet Debug-PersonalTeam en Archive moet Release gebruiken.");
const stdScheme = read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme");
ok(/<LaunchAction\s+buildConfiguration = "Debug"/.test(stdScheme) && /<ArchiveAction\s+buildConfiguration = "Release"/.test(stdScheme) && !/Debug-PersonalTeam/.test(stdScheme), "Scheme App moet Debug (Run) en Release (Archive) gebruiken en mag niets met PersonalTeam te maken hebben.");
ok(/Local\.xcconfig/.test(read(".gitignore")), "mobile/.gitignore moet ios/Local.xcconfig negeren.");
ok(/profile:"standard"/.test(read("public/ringtools-build.js")), "public/ringtools-build.js moet het standaardprofiel zetten.");
ok(/script src="\.\/ringtools-build\.js"/.test(read("index.html")), "index.html moet ringtools-build.js laden.");

// 4. Content-Security-Policy aanwezig, geen inline scripts toegestaan.
const html = read("index.html");
ok(/Content-Security-Policy/.test(html) && /script-src 'self'/.test(html), "index.html: strikte CSP met script-src 'self' ontbreekt.");

// 5. Geen geheimen of ondertekeningsbestanden in de werkmap (los van .gitignore).
const forbidden = /\.(jks|keystore|p8|p12|mobileprovision|pem|key)$|^google-services\.json$|^GoogleService-Info\.plist$|^keystore\.properties$/;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "Pods", "build", ".gradle"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (forbidden.test(name)) errors.push(`Geheim/ondertekeningsbestand in de projectmap: ${relative(root, p)} (niet committen).`);
  }
})(root);

// 6. Assets aanwezig.
ok(existsSync(join(root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png")), "Android-app-icoon ontbreekt (npm run assets).");
ok(existsSync(join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset")), "iOS-app-icoon ontbreekt (npm run assets).");

// 7. App Store Connect-eisen (TestFlight): iconen, privacymanifest, versie.
{
  const iconPath = join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
  if (existsSync(iconPath)) {
    const png = readFileSync(iconPath);
    const isPng = png.length > 33 && png.subarray(1, 4).toString() === "PNG";
    ok(isPng, "iOS-appicoon is geen geldige PNG.");
    if (isPng) {
      const [w, h, colorType] = [png.readUInt32BE(16), png.readUInt32BE(20), png[25]];
      ok(w === 1024 && h === 1024, `iOS-appicoon moet 1024 × 1024 zijn (nu ${w} × ${h}).`);
      ok(colorType !== 4 && colorType !== 6, "iOS-appicoon mag geen alfakanaal (transparantie) hebben; App Store Connect weigert dat.");
      ok(!png.includes(Buffer.from("tRNS")), "iOS-appicoon mag geen transparantie-informatie (tRNS) bevatten.");
    }
  }
  ok(existsSync(join(root, "ios/App/App/PrivacyInfo.xcprivacy")), "ios/App/App/PrivacyInfo.xcprivacy ontbreekt (privacymanifest, vereist door App Store Connect).");
  ok(/PrivacyInfo\.xcprivacy in Resources/.test(pbx), "PrivacyInfo.xcprivacy zit niet in de Resources-fase van het Xcode-project.");
  const manifest = existsSync(join(root, "ios/App/App/PrivacyInfo.xcprivacy")) ? read("ios/App/App/PrivacyInfo.xcprivacy") : "";
  ok(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(manifest), "Privacymanifest: NSPrivacyTracking moet false zijn (Ringtools volgt gebruikers niet).");
  ok(/MARKETING_VERSION = \d+\.\d+(\.\d+)?;/.test(pbx) && /CURRENT_PROJECT_VERSION = \d+;/.test(pbx), "Xcode-project: MARKETING_VERSION of CURRENT_PROJECT_VERSION ontbreekt of is ongeldig.");
  const appDelegate = read("ios/App/App/AppDelegate.swift");
  ok(/didRegisterForRemoteNotificationsWithDeviceToken[\s\S]*capacitorDidRegisterForRemoteNotifications/.test(appDelegate) && /didFailToRegisterForRemoteNotificationsWithError[\s\S]*capacitorDidFailToRegisterForRemoteNotifications/.test(appDelegate),
    "AppDelegate.swift: de APNs-doorgeefluiken (didRegister…/didFailToRegister… → Capacitor-notificaties) ontbreken; zonder die krijgt de app nooit een pushtoken.");
  // Native iOS-tabbalk (UITabBar, Liquid Glass op iOS 26+): eigen lokale plug-in, publieke Apple-API's.
  {
    const iosApp = join(root, "ios/App/App");
    const read = (f) => (existsSync(join(iosApp, f)) ? readFileSync(join(iosApp, f), "utf8") : "");
    const plugin = read("NativeTabBarPlugin.swift");
    ok(plugin.includes("UITabBar") && plugin.includes('jsName = "NativeTabBar"'), "NativeTabBarPlugin.swift ontbreekt of mist UITabBar/jsName NativeTabBar.");
    ok(!/private\s+api|_UIBarBackground|valueForKey\(\s*"_/i.test(plugin), "NativeTabBarPlugin.swift mag geen niet-openbare API's gebruiken.");
    ok(read("MainViewController.swift").includes("registerPluginInstance(NativeTabBarPlugin())"), "MainViewController registreert NativeTabBarPlugin niet.");
    ok(read("SceneDelegate.swift").includes("MainViewController()"), "SceneDelegate moet MainViewController gebruiken.");
    ok(read("Base.lproj/Main.storyboard").includes('customClass="MainViewController"'), "Main.storyboard moet MainViewController gebruiken.");
    const proj = readFileSync(join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
    ok(/NativeTabBarPlugin\.swift in Sources/.test(proj) && /MainViewController\.swift in Sources/.test(proj), "NativeTabBarPlugin.swift/MainViewController.swift staan niet in de Sources-buildfase.");
    const ts = readFileSync(join(root, "src/lib/nativeTabBar.ts"), "utf8");
    ok(ts.includes('registerPlugin<Raw>("NativeTabBar")') && /Capacitor\.getPlatform\(\) === "ios"/.test(ts), "nativeTabBar.ts moet de plug-in NativeTabBar alleen op iOS gebruiken.");
  }
  const tf = existsSync(join(root, "../.github/workflows/ios-testflight.yml")) ? readFileSync(join(root, "../.github/workflows/ios-testflight.yml"), "utf8") : "";
  ok(tf.length > 0, ".github/workflows/ios-testflight.yml ontbreekt.");
  ok(!/-----BEGIN|AuthKey_[A-Z0-9]{10}\.p8/.test(tf.replace(/AuthKey_\$\{ASC_KEY_ID\}\.p8/g, "")), "ios-testflight.yml bevat een sleutel of vaste sleutelnaam.");
  ok(!/echo\s+"?\$\{?(ASC_API_KEY_P8_BASE64|ASC_KEY_ID|ASC_ISSUER_ID)[^|>]*$/m.test(tf), "ios-testflight.yml mag secrets niet printen.");
  ok(/signingCertificate<\/key><string>Apple Distribution/.test(tf), "ios-testflight.yml moet in de export-opties expliciet 'Apple Distribution' vragen.");
  ok(/verify-ios-bundle\.py --stage ipa/.test(tf) && /verify-ios-bundle\.py --stage archive/.test(tf), "ios-testflight.yml moet archive en IPA met verify-ios-bundle.py (echte plist-parser) controleren.");
  ok(!/grep[^\n]*get-task-allow/.test(tf), "get-task-allow mag niet met grep worden gecontroleerd (een App Store-plist is één regel; gebruik de plist-parser).");
  ok(existsSync(join(root, "scripts/verify-ios-bundle.py")), "scripts/verify-ios-bundle.py ontbreekt.");
  ok(/environment:\s*testflight/.test(tf) && /workflow_dispatch:/.test(tf) && !/\n\s*(push|pull_request|schedule):/.test(tf), "ios-testflight.yml moet handmatig (workflow_dispatch) draaien met de omgeving 'testflight'.");
}

// Splash: expliciete native verwijzingen, vaste donkere achtergrond en begrensde beeldverhouding.
const launch = read("ios/App/App/Base.lproj/LaunchScreen.storyboard");
ok(launch.includes('contentMode="scaleAspectFit"') && !launch.includes('scaleAspectFill'), "iOS-splash mag het logo niet bijsnijden of schermvullend oprekken.");
ok(launch.includes('id="mark-fit-width"') && launch.includes('id="mark-fit-height"'), "iOS-splash moet op smalle en liggende schermen begrensd blijven.");
const launchTheme = read("android/app/src/main/res/values/styles.xml");
ok(launchTheme.includes('name="windowSplashScreenAnimatedIcon">@drawable/splash_mark'), "Android 12+-splash moet het Ringtools-beeld expliciet gebruiken.");
ok(launchTheme.includes('name="windowSplashScreenBackground">@color/splash_background'), "Android-splash moet de donkere achtergrond expliciet gebruiken.");

if (errors.length) {
  console.error("Native configuratie: FOUT\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`Native configuratie OK (appId ${idDefault}, link-host ${androidHosts[0]}).`);
