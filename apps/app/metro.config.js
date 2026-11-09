// Metro config: Expo defaults, plus one fix.
// pdf-lib (PDF report) imports tslib; Metro's package-exports resolution picks tslib's
// modules/index.js, whose default-import interop breaks in the web bundle
// ("Cannot destructure property '__extends'"). Point it at tslib's plain ES build.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
const tslib = path.join(path.dirname(require.resolve("tslib/package.json")), "tslib.es6.js");
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "tslib") return { type: "sourceFile", filePath: tslib };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
