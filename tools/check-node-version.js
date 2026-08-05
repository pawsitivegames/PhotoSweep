const requiredMajor = 22
const actualMajor = Number.parseInt(process.versions.node.split(".")[0], 10)

if (actualMajor < requiredMajor) {
  console.error(
    `\nUnsupported Node version: ${process.version} (need >=${requiredMajor}.x.x)\n` +
      "Run 'nvm use' to switch to the version pinned in .nvmrc.\n"
  )
  process.exit(1)
}
