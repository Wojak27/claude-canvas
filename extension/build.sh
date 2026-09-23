#!/usr/bin/env bash
# Package the extension as a .vsix (a plain zip) — no npm/vsce needed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ver="$(node -p "require('$here/package.json').version")"
out="$here/claude-canvas-$ver.vsix"
tmp="$(mktemp -d)"
mkdir -p "$tmp/extension"
cp -r "$here"/*.js "$here/package.json" "$here/media" "$here/README.md" "$tmp/extension/"

# every local require must have shipped, or the extension dies at load time
node -e '
const fs = require("fs"), path = require("path");
const dir = process.argv[1];
let bad = 0;
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  for (const m of src.matchAll(/require\(\"(\.[^\"]+)\"\)|require\(\x27(\.[^\x27]+)\x27\)/g)) {
    const rel = m[1] || m[2];
    if (!fs.existsSync(path.join(dir, rel))) { console.error("missing in package: " + f + " -> " + rel); bad++; }
  }
}
if (bad) process.exit(1);
console.error("requires ok");
' "$tmp/extension"
cat > "$tmp/[Content_Types].xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="xml" ContentType="text/xml"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>
XML
cat > "$tmp/extension.vsixmanifest" <<XML
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="claude-canvas" Version="$ver" Publisher="local"/>
    <DisplayName>Claude Canvas</DisplayName>
    <Description xml:space="preserve">A live board Claude Code can write to: current work state, notes and images.</Description>
    <Tags>claude,dashboard,images</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets>
</PackageManifest>
XML
rm -f "$out"
( cd "$tmp" && zip -q -r "$out" . )
rm -rf "$tmp"
echo "$out"
