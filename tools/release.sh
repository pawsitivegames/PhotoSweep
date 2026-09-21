#!/usr/bin/env bash
set -euo pipefail

# Get current version from package.json
CURRENT=$(node -p "require('./package.json').version")

# Compute default patch bump. Use X.Y.0 for a feature release and X.0.0 for
# a major or breaking release when choosing a different VERSION below.
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
DEFAULT="${MAJOR}.${MINOR}.$((PATCH + 1))"

echo "Current version: $CURRENT"
echo -n "New version [$DEFAULT]: "
read -r INPUT
VERSION="${INPUT:-$DEFAULT}"

# Basic semver validation
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: '$VERSION' is not a valid semver (expected X.Y.Z)"
  exit 1
fi

TAG="v${VERSION}"

echo ""
echo "Releasing $TAG"
echo "  - npm version $VERSION"
echo "  - git tag $TAG"
echo "  - git push origin main"
echo "  - git push origin $TAG"
echo -n "Proceed? [y/N] "
read -r CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
  echo "Aborted."
  exit 0
fi

# Update package.json version without creating a git commit/tag
npm version "$VERSION" --no-git-tag-version

# Keep Chrome's independently tracked numeric version aligned with the new app
# release. Rebuilds of the same app version must increment this fourth
# component manually before running package:cws again.
node - "$VERSION" <<'NODE'
const fs = require("node:fs")

const version = process.argv[2]
const packagePath = "package.json"
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"))
packageJson.chromeVersion = `${version}.1`
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
NODE

# Commit the version bump
git add package.json package-lock.json
git commit -m "Release $TAG"

# Tag and push
git tag "$TAG"
git push origin main
git push origin "$TAG"

echo ""
echo "Done. $TAG pushed."
