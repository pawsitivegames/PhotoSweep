const RELEASE_CONFIG_KEYS = [
  "PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_BASE_URL",
  "PLASMO_PUBLIC_PHOTOSWEEP_LICENSE_API_HOST_PERMISSION",
  "PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY"
]

function parseEnvironmentExample(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  )
}

/**
 * @param {{ environment?: Record<string, string | undefined>, exampleSource: string, allowDevEntitlement?: string }} options
 */
export function createReleasePackageEnvironment({
  environment = process.env,
  exampleSource,
  allowDevEntitlement = "0"
}) {
  const example = parseEnvironmentExample(exampleSource)
  const configured = {}

  for (const key of RELEASE_CONFIG_KEYS) {
    const value = environment[key] || example[key]
    if (!value) continue
    if (
      key === "PLASMO_PUBLIC_PHOTOSWEEP_ENTITLEMENT_PUBLIC_KEY" &&
      value === "BASE64URL_SPKI_PUBLIC_KEY"
    ) {
      continue
    }
    configured[key] = value
  }

  return {
    ...environment,
    ...configured,
    PLASMO_PUBLIC_PHOTOSWEEP_ALLOW_DEV_ENTITLEMENT: allowDevEntitlement
  }
}
