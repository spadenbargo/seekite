"use strict";

// Docusaurus 3 loads plugins through jiti 1.x, which rewrites dynamic imports
// to CommonJS. Keep the ESM-only build pipeline behind Node's native loader.
module.exports = function loadBuildModule() {
  return import("@seekite/build");
};
