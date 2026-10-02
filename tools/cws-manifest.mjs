const PROVIDER_ORDER = ["google", "icloud", "amazon"]
const SCRIPT_PATTERN = /^(google|icloud|amazon)-photos-(bridge|inject)\.[a-f0-9]{8}\.js$/

/**
 * Keep provider bridges ahead of injectors. Injectors can synchronously send
 * page messages as soon as they run, so each provider bridge must already be
 * listening. Plasmo's generated array order is not stable across builds.
 */
export function orderProviderContentScripts(contentScripts) {
  if (!Array.isArray(contentScripts)) {
    throw new TypeError("Expected manifest.content_scripts to be an array")
  }

  const classified = contentScripts.map((entry) => {
    if (!Array.isArray(entry?.js) || entry.js.length !== 1) {
      throw new Error("Each provider content script must declare exactly one JS bundle")
    }

    const match = SCRIPT_PATTERN.exec(entry.js[0])
    if (!match) {
      throw new Error(`Unclassified provider content script: ${entry.js[0]}`)
    }

    return { entry, provider: match[1], phase: match[2] }
  })

  const expected = new Set(
    PROVIDER_ORDER.flatMap((provider) => [
      `${provider}:bridge`,
      `${provider}:inject`
    ])
  )
  const seen = new Set()
  for (const item of classified) {
    const key = `${item.provider}:${item.phase}`
    if (!expected.has(key) || seen.has(key)) {
      throw new Error(`Duplicate provider content script: ${key}`)
    }
    seen.add(key)
  }
  for (const key of expected) {
    if (!seen.has(key)) throw new Error(`Missing provider content script: ${key}`)
  }

  return classified
    .sort((left, right) => {
      const providerDifference =
        PROVIDER_ORDER.indexOf(left.provider) -
        PROVIDER_ORDER.indexOf(right.provider)
      if (providerDifference !== 0) return providerDifference
      return left.phase === right.phase ? 0 : left.phase === "bridge" ? -1 : 1
    })
    .map(({ entry }) => entry)
}
