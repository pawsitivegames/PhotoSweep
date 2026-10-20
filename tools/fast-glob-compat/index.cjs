"use strict"

const {
  convertPathToPattern,
  escapePath,
  glob,
  globSync,
  isDynamicPattern
} = require("tinyglobby")

function fastGlob(patterns, options) {
  return glob(patterns, options)
}

fastGlob.sync = (patterns, options) => globSync(patterns, options)
fastGlob.glob = fastGlob
fastGlob.globSync = fastGlob.sync
fastGlob.convertPathToPattern = convertPathToPattern
fastGlob.escapePath = escapePath
fastGlob.isDynamicPattern = isDynamicPattern

module.exports = fastGlob
