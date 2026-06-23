// Lock all text to a fixed size app-wide: ignore the OS "Larger Text" / font-size
// accessibility setting everywhere.
//
// In RN 0.85 `Text`/`TextInput` are plain function components, and React 19 no
// longer applies `defaultProps` to them, so the old `Text.defaultProps` trick is
// dead. Instead we wrap the JSX runtime (and the legacy `createElement` path) so
// every Text/TextInput element gets `allowFontScaling: false` unless it already
// set the prop explicitly.
import React from "react";
import { Text, TextInput } from "react-native";

const TARGETS = new Set([Text, TextInput]);

function lockProps(type, props) {
  if (!TARGETS.has(type)) return props;
  if (props && props.allowFontScaling !== undefined) return props;
  return { ...props, allowFontScaling: false };
}

function wrapJsx(mod, key) {
  const original = mod && mod[key];
  if (typeof original !== "function" || original.__fixedFontScale) return;
  const wrapped = function (type, props, ...rest) {
    return original(type, lockProps(type, props), ...rest);
  };
  wrapped.__fixedFontScale = true;
  mod[key] = wrapped;
}

// Automatic JSX runtime (production + the dev variant used by Metro).
try {
  const runtime = require("react/jsx-runtime");
  wrapJsx(runtime, "jsx");
  wrapJsx(runtime, "jsxs");
} catch (e) {}
try {
  const devRuntime = require("react/jsx-dev-runtime");
  wrapJsx(devRuntime, "jsxDEV");
} catch (e) {}

// Classic createElement path, as a fallback.
if (!React.createElement.__fixedFontScale) {
  const original = React.createElement;
  const wrapped = function (type, props, ...children) {
    return original.call(React, type, lockProps(type, props), ...children);
  };
  wrapped.__fixedFontScale = true;
  React.createElement = wrapped;
}
