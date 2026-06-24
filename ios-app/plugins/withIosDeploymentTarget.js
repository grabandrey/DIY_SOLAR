// Expo config plugin: bump every Pod (including resource-bundle sub-targets like
// RNCAsyncStorage_resources and RNSVGFilters) to the minimum iOS deployment target
// Xcode supports. expo-build-properties sets `platform :ios` for the app, but those
// resource bundles keep the low targets declared in their podspecs, which trips the
// "deployment target 12.4/13.4 ... supported range is 15.0+" build warnings.
//
// A plain Podfile edit is wiped by `expo prebuild`; this plugin re-injects the fix into
// the generated Podfile on every prebuild. Registered via app.json plugins.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "[withIosDeploymentTarget]";

function snippet(minIos) {
  return `
    # ${MARKER} Force every pod (incl. resource bundles) up to a supported iOS target.
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |bc|
        current = bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || current.to_f < '${minIos}'.to_f
          bc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${minIos}'
        end
      end
    end
`;
}

module.exports = function withIosDeploymentTarget(config, { deploymentTarget = "16.4" } = {}) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      if (!contents.includes(MARKER)) {
        // Insert immediately inside the existing post_install hook.
        contents = contents.replace(
          /post_install do \|installer\|/,
          (match) => `${match}\n${snippet(deploymentTarget)}`
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
