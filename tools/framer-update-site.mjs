import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { connect } from "framer-api"

function loadHomeEnv() {
  const envPath = path.join(os.homedir(), ".env")
  if (!fs.existsSync(envPath)) return

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const equalsIndex = line.indexOf("=")
    if (equalsIndex === -1) continue

    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] ??= value
  }
}

const componentCode = `
import * as React from "react"

const products = [
  ["Photos", "Organize, deduplicate, and find your photos fast. Local-first, private, and lightweight.", "IMG"],
  ["Languages", "Learn languages with spaced repetition, smart reviews, and real conversation practice.", "TXT"],
  ["Voice", "Transcribe, summarize, and automate voice workflows with on-device privacy.", "MIC"],
  ["Health", "Track habits, sleep, mood, and activities. Your data stays with you.", "FIT"],
  ["Finance", "Budget, track expenses, and plan ahead with simple, effective tools.", "USD"],
  ["Games", "Thoughtful games that respect your time and focus on real fun.", "PAD"],
]

const checks = [
  "Local-first by default",
  "Optional usage metrics only with consent",
  "Transparent and open communication",
  "Secure data handling",
]

export default function PawsitiveGamesHomeCodex() {
  return (
    <main className="pg-site">
      <style>{css}</style>
      <header className="pg-header">
        <a className="pg-brand" href="#top" aria-label="Pawsitive Games home">
          <span className="pg-mark">PG</span>
          <span>Pawsitive Games</span>
        </a>
        <nav className="pg-nav" aria-label="Primary navigation">
          <a href="#products">Products</a>
          <a href="#privacy">Privacy</a>
          <a href="#support">Support</a>
          <a href="mailto:pawsitivegames@gmail.com">Contact</a>
        </nav>
        <a className="pg-button pg-button-primary pg-header-button" href="#products">View products</a>
      </header>

      <section className="pg-hero" id="top">
        <div className="pg-hero-copy">
          <h1>Practical software for everyday digital workflows.</h1>
          <p>
            Tools for photo organization, language learning, voice workflows,
            health tracking, personal finance, games, and automation.
          </p>
          <div className="pg-actions">
            <a className="pg-button pg-button-primary" href="#products">View products</a>
            <a className="pg-button pg-button-secondary" href="mailto:pawsitivegames@gmail.com">Contact support</a>
          </div>
        </div>

        <div className="pg-product-preview" aria-label="Product preview">
          <div className="pg-preview-top">
            <span className="pg-dot"></span>
            <strong>Pawsitive Photos</strong>
            <span className="pg-mini">Private library tools</span>
          </div>
          <div className="pg-preview-body">
            <aside>
              <span className="active">Library</span>
              <span>Albums</span>
              <span>People</span>
              <span>Duplicates</span>
              <span>Trash</span>
            </aside>
            <div className="pg-gallery">
              <div>
                <span>All Photos</span>
                <strong>8,342 items</strong>
              </div>
              {Array.from({ length: 6 }).map((_, index) => (
                <i key={index} className={'tile tile-' + index}></i>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="pg-section" id="products">
        <div className="pg-section-heading">
          <h2>Our product suite</h2>
          <p>Focused tools. Clear purpose. Built for real-world use.</p>
        </div>
        <div className="pg-products">
          {products.map(([name, description, label]) => (
            <article className="pg-product" key={name}>
              <div className="pg-icon">{label}</div>
              <div>
                <h3>Pawsitive {name}</h3>
                <p>{description}</p>
              </div>
              <span className="pg-arrow">View</span>
            </article>
          ))}
        </div>
      </section>

      <section className="pg-privacy" id="privacy">
        <div>
          <h2>Privacy first. Always.</h2>
          <p>
            We build software that respects your data and your time. Photo
            matching runs locally in the browser with MediaPipe. Provider CDNs
            still serve thumbnails, while provider APIs or web sessions handle
            library and Trash or Recently Deleted requests. External Stripe Checkout, licensing,
            and optional consent-gated usage metrics are separate network paths.
          </p>
          <ul>
            {checks.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <a href="mailto:pawsitivegames@gmail.com">Ask about our privacy policy</a>
        </div>
        <div className="pg-lock" aria-hidden="true">
          <span></span>
          <div>
            <b>Matching stays local</b>
            <b>No ads</b>
            <b>No data selling</b>
            <b>Consent-gated analytics</b>
          </div>
        </div>
      </section>

      <section className="pg-details" id="support">
        <article>
          <h2>Secure payments with Stripe</h2>
          <p>
            We use Stripe Checkout for secure payment processing and license
            checkout. Stripe handles payment details; Pawsitive Games stores
            only the license records and payment identifiers needed for
            entitlements, refunds, and support.
          </p>
          <div className="pg-payments">
            <span>stripe</span><span>visa</span><span>mc</span><span>amex</span>
          </div>
        </article>
        <article>
          <h2>Customer details</h2>
          <p>
            Pawsitive Games<br />
            Software company<br />
            United States
          </p>
          <p>
            Contact: <a href="mailto:pawsitivegames@gmail.com">pawsitivegames@gmail.com</a><br />
            Website: <a href="https://pawsitivegames.com">https://pawsitivegames.com</a>
          </p>
        </article>
      </section>

      <footer className="pg-footer">
        <div>
          <a className="pg-brand" href="#top"><span className="pg-mark">PG</span><span>Pawsitive Games</span></a>
          <p>Practical software for everyday digital workflows.</p>
        </div>
        <div>
          <h3>Quick links</h3>
          <a href="#products">Products</a>
          <a href="#privacy">Privacy</a>
          <a href="#support">Support</a>
          <a href="mailto:pawsitivegames@gmail.com">Contact</a>
        </div>
        <div>
          <h3>Support</h3>
          <a href="mailto:pawsitivegames@gmail.com">Help center</a>
          <a href="mailto:pawsitivegames@gmail.com">Contact support</a>
          <a href="#support">Status</a>
        </div>
        <div>
          <h3>Get in touch</h3>
          <p>Email: <a href="mailto:pawsitivegames@gmail.com">pawsitivegames@gmail.com</a></p>
          <p>We typically reply within one business day.</p>
        </div>
      </footer>
    </main>
  )
}

const css = \`
.pg-site{width:100%;min-height:100%;background:#fbfcff;color:#0b1020;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}
.pg-site *{box-sizing:border-box}
.pg-site a{color:inherit;text-decoration:none}
.pg-header{height:84px;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 clamp(20px,5vw,72px);border-bottom:1px solid #e8eaf1;background:rgba(251,252,255,.94);position:sticky;top:0;z-index:20;backdrop-filter:blur(12px)}
.pg-brand{display:inline-flex;align-items:center;gap:12px;font-size:22px;font-weight:760}
.pg-mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#4d3df7;color:white;font-size:11px;font-weight:850;letter-spacing:.04em}
.pg-nav{display:flex;gap:34px;font-size:15px;font-weight:650;color:#1f2635}
.pg-button{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 24px;border-radius:10px;font-size:15px;font-weight:760}
.pg-button-primary{background:#4d3df7;color:white;box-shadow:0 10px 24px rgba(77,61,247,.22)}
.pg-button-secondary{background:white;color:#111827;border:1px solid #dfe3ed}
.pg-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(420px,640px);gap:64px;align-items:center;padding:clamp(72px,8vw,116px) clamp(20px,5vw,72px) 72px;max-width:1440px;margin:0 auto}
.pg-hero h1{margin:0;font-size:clamp(48px,6vw,78px);line-height:.98;letter-spacing:0;font-weight:850;max-width:720px}
.pg-hero p{margin:28px 0 0;font-size:clamp(19px,2vw,24px);line-height:1.55;color:#596174;max-width:670px}
.pg-actions{display:flex;gap:18px;flex-wrap:wrap;margin-top:36px}
.pg-product-preview{background:white;border:1px solid #e2e5ee;border-radius:18px;box-shadow:0 24px 80px rgba(27,34,57,.12);overflow:hidden}
.pg-preview-top{height:64px;display:flex;align-items:center;gap:12px;padding:0 22px;border-bottom:1px solid #eef0f5}
.pg-dot{width:14px;height:14px;border-radius:50%;background:#4d3df7}
.pg-mini{margin-left:auto;color:#6b7280;font-size:12px}
.pg-preview-body{display:grid;grid-template-columns:160px 1fr;min-height:360px}
.pg-preview-body aside{display:flex;flex-direction:column;gap:10px;padding:22px;background:#f7f8ff;border-right:1px solid #eef0f5}
.pg-preview-body aside span{padding:10px 12px;border-radius:9px;color:#596174;font-size:13px;font-weight:650}
.pg-preview-body aside .active{background:white;color:#4d3df7}
.pg-gallery{padding:28px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-content:start}
.pg-gallery div{grid-column:1/-1;display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:8px}
.pg-gallery span{font-size:22px;font-weight:820}.pg-gallery strong{font-size:13px;color:#6b7280}
.tile{height:98px;border-radius:12px;background:linear-gradient(135deg,#dfe7ff,#739af2)}
.tile-1{background:linear-gradient(135deg,#dff7ec,#45b883)}.tile-2{background:linear-gradient(135deg,#fff0c7,#f3a840)}.tile-3{background:linear-gradient(135deg,#d7f0ff,#368fd8)}.tile-4{background:linear-gradient(135deg,#ffe1eb,#eb6f94)}.tile-5{background:linear-gradient(135deg,#e7e1ff,#7859f5)}
.pg-section{padding:70px clamp(20px,5vw,72px);max-width:1160px;margin:0 auto}
.pg-section-heading{text-align:center;margin-bottom:28px}.pg-section-heading h2,.pg-privacy h2,.pg-details h2{font-size:34px;line-height:1.1;margin:0 0 12px;font-weight:830}.pg-section-heading p,.pg-product p,.pg-privacy p,.pg-details p,.pg-footer p{color:#5f687a;line-height:1.6}
.pg-products{display:grid;gap:16px}.pg-product{display:grid;grid-template-columns:82px 1fr auto;align-items:center;gap:24px;background:white;border:1px solid #e5e8f0;border-radius:14px;padding:24px;box-shadow:0 12px 34px rgba(20,28,45,.04)}
.pg-icon{width:62px;height:62px;border-radius:16px;display:grid;place-items:center;background:#eef2ff;color:#4d3df7;font-size:13px;font-weight:900}.pg-product:nth-child(2n) .pg-icon{background:#eaf8f0;color:#19956a}.pg-product:nth-child(3n) .pg-icon{background:#f1eaff;color:#6b43f2}
.pg-product h3{font-size:24px;margin:0 0 7px;font-weight:820}.pg-product p{margin:0;max-width:600px}.pg-arrow{color:#4d3df7;font-weight:800}
.pg-privacy{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:60px;align-items:center;padding:70px clamp(20px,5vw,72px);max-width:1160px;margin:0 auto}
.pg-privacy ul{list-style:none;padding:0;margin:28px 0;display:grid;gap:12px}.pg-privacy li{color:#20293a}.pg-privacy li:before{content:"✓";color:#4d3df7;font-weight:900;margin-right:10px}.pg-privacy a{color:#4d3df7;font-weight:800}
.pg-lock{display:flex;align-items:center;justify-content:center;gap:28px}.pg-lock>span{width:160px;height:150px;border-radius:28px;background:linear-gradient(180deg,#e7e4ff,#bfc4ff);position:relative;box-shadow:0 18px 50px rgba(77,61,247,.18)}.pg-lock>span:before{content:"";position:absolute;left:44px;right:44px;top:-74px;height:102px;border:22px solid #dedbff;border-bottom:0;border-radius:70px 70px 0 0}.pg-lock div{background:white;border:1px solid #e5e8f0;border-radius:16px;padding:20px;display:grid;gap:16px;box-shadow:0 16px 40px rgba(20,28,45,.08)}.pg-lock b{font-size:14px;color:#314054}.pg-lock b:before{content:"✓";color:#1fa971;margin-right:10px}
.pg-details{display:grid;grid-template-columns:1fr 1fr;gap:48px;padding:58px clamp(20px,5vw,72px);background:#f4f6fb;border-top:1px solid #e5e8f0;border-bottom:1px solid #e5e8f0}.pg-details article{max-width:520px;margin:0 auto}.pg-payments{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.pg-payments span{background:white;border:1px solid #dfe3ed;border-radius:10px;padding:10px 16px;color:#4d3df7;text-transform:uppercase;font-weight:900}
.pg-footer{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:40px;padding:46px clamp(20px,5vw,72px);max-width:1280px;margin:0 auto}.pg-footer h3{margin:0 0 14px;font-size:15px}.pg-footer a{display:block;color:#364154;margin:10px 0}.pg-footer .pg-brand{margin-bottom:16px}.pg-footer .pg-brand span:last-child{color:#0b1020}
@media(max-width:900px){.pg-header{height:auto;padding:18px 20px;align-items:flex-start}.pg-nav,.pg-header-button{display:none}.pg-hero,.pg-privacy,.pg-details,.pg-footer{grid-template-columns:1fr}.pg-hero{gap:40px;padding-top:54px}.pg-preview-body{grid-template-columns:1fr}.pg-preview-body aside{display:none}.pg-product{grid-template-columns:64px 1fr}.pg-arrow{display:none}.pg-lock{justify-content:flex-start}.pg-gallery{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.pg-hero h1{font-size:42px}.pg-actions{display:grid}.pg-product{grid-template-columns:1fr;padding:20px}.pg-details{gap:28px}.pg-footer{gap:24px}.pg-lock{display:none}}
\`
`

async function main() {
  loadHomeEnv()
  const apiKey = process.env.FRAMER_API_KEY ?? process.env.FRAMER_API_TOKEN
  const projectUrl = process.env.FRAMER_PROJECT_URL ?? process.env.FRAMER_PROJECT_ID
  if (!apiKey) throw new Error("Missing FRAMER_API_KEY or FRAMER_API_TOKEN in ~/.env")
  if (!projectUrl) throw new Error("Missing FRAMER_PROJECT_URL or FRAMER_PROJECT_ID in ~/.env")

  const framer = await connect(projectUrl, apiKey)

  try {
    let file = (await framer.getCodeFiles()).find((item) => item.name === "PawsitiveGamesHomeCodex.tsx")
    if (file) {
      file = await file.setFileContent(componentCode)
    } else {
      file = await framer.createCodeFile("PawsitiveGamesHomeCodex.tsx", componentCode)
    }

    const componentExport = file.exports.find((item) => item.type === "component")
    if (!componentExport?.insertURL) {
      throw new Error("PawsitiveGamesHomeCodex.tsx did not expose an insertable component export.")
    }

    const pages = await framer.getNodesWithType("WebPageNode")
    const home = pages.find((page) => page.path === "/") ?? pages[0]
    if (!home) throw new Error("Could not find a web page to update.")

    const existing = await framer.getNodesWithType("ComponentInstanceNode")
    for (const node of existing) {
      if (node.componentName === "PawsitiveGamesHomeCodex") {
        await node.remove()
      }
    }

    const node = await framer.addComponentInstance({
      url: componentExport.insertURL,
      parentId: home.id,
      attributes: {
        name: "Pawsitive Games Homepage",
        position: "relative",
        width: "1200px",
        height: "3600px",
      },
    })

    const changedPaths = await framer.getChangedPaths()
    let publishResult = null
    let hostnames = []

    if (process.env.FRAMER_SKIP_PUBLISH !== "1") {
      publishResult = await framer.publish()
      hostnames = await framer.deploy(publishResult.deployment.id)
    }

    console.log(
      JSON.stringify(
        {
          codeFile: { id: file.id, name: file.name, exports: file.exports },
          insertedNode: { id: node.id, componentName: node.componentName },
          changedPaths,
          deployment: publishResult?.deployment ?? null,
          hostnames,
        },
        null,
        2
      )
    )
  } finally {
    await framer.disconnect()
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        name: error.name,
        message: error.message,
        code: error.code,
        ref: error.ref,
        retryable: error.retryable,
      },
      null,
      2
    )
  )
  process.exit(1)
})
