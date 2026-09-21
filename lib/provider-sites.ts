/**
 * Explicit provider site coverage used by the extension-side routing and
 * content-script configuration.
 *
 * Keep these hosts narrow. A broad wildcard would make regional support look
 * complete while granting access to unrelated pages and marketplaces.
 */

export const AMAZON_MARKETPLACE_HOSTS = [
  "amazon.com",
  "amazon.ca",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.co.jp",
  "amazon.com.au",
  "amazon.in",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.nl",
  "amazon.sg",
  "amazon.ae",
  "amazon.sa",
  "amazon.se",
  "amazon.pl",
  "amazon.com.tr",
  "amazon.com.be",
  "amazon.eg",
  "amazon.ie"
] as const

export const AMAZON_ORIGINS = AMAZON_MARKETPLACE_HOSTS.flatMap((host) => [
  `https://www.${host}`,
  `https://${host}`
])

export const AMAZON_PHOTOS_CONTENT_MATCHES = AMAZON_ORIGINS.map(
  (origin) => `${origin}/photos*`
)

export const AMAZON_ORIGIN_MATCHES = AMAZON_ORIGINS.map(
  (origin) => `${origin}/*`
)

export const ICLOUD_HOSTS = [
  "www.icloud.com",
  "icloud.com",
  "www.icloud.com.cn",
  "icloud.com.cn"
] as const

export const ICLOUD_ORIGINS = ICLOUD_HOSTS.map((host) => `https://${host}`)

export const ICLOUD_ORIGIN_MATCHES = ICLOUD_ORIGINS.map(
  (origin) => `${origin}/*`
)

export const GOOGLE_PHOTOS_ORIGINS = ["https://photos.google.com"] as const

export const GOOGLE_PHOTOS_ORIGIN_MATCHES = GOOGLE_PHOTOS_ORIGINS.map(
  (origin) => `${origin}/*`
)
