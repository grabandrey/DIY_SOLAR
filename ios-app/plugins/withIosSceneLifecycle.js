const { withDangerousMod, withInfoPlist } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "[withIosSceneLifecycle]";

const legacyWindowStartup = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const sceneDelegate = `// ${MARKER}
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      session.role == .windowApplication,
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: appDelegate.launchOptions
    )
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else {
      return
    }

    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

`;

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };

    return cfg;
  });
}

function withSceneDelegate(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const appDelegatePath = path.join(
        cfg.modRequest.platformProjectRoot,
        cfg.modRequest.projectName,
        "AppDelegate.swift"
      );
      let contents = fs.readFileSync(appDelegatePath, "utf8");

      if (contents.includes(MARKER)) {
        return cfg;
      }

      if (!contents.includes(legacyWindowStartup)) {
        throw new Error(
          `${MARKER} Could not find Expo's AppDelegate window startup block.`
        );
      }

      contents = contents.replace(
        "  var window: UIWindow?\n",
        "  var window: UIWindow?\n  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?\n"
      );
      contents = contents.replace(
        "  ) -> Bool {\n    let delegate = ReactNativeDelegate()",
        "  ) -> Bool {\n    self.launchOptions = launchOptions\n\n    let delegate = ReactNativeDelegate()"
      );
      contents = contents.replace(legacyWindowStartup, "");
      contents = contents.replace(
        "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {",
        `${sceneDelegate}class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {`
      );

      fs.writeFileSync(appDelegatePath, contents);
      return cfg;
    },
  ]);
}

module.exports = function withIosSceneLifecycle(config) {
  config = withSceneManifest(config);
  return withSceneDelegate(config);
};
