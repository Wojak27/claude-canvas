#!/usr/bin/env bash
# Regenerate everything in media/ from the real renderer.
# Needs: node, python3 + Pillow, google-chrome, ffmpeg.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
work="${TMPDIR:-/tmp}/canvas-shots"
scenes="${TMPDIR:-/tmp}/canvas-scenes"
rm -rf "$work"; mkdir -p "$work" "$repo/media"

python3 "$here/demo_scenes.py" "$scenes" >/dev/null

# Headless Chrome clamps the viewport to 485 CSS px, so render at that width and
# crop afterwards rather than fighting it.
VIEW=485
shot() { # <html> <out.png> <dsf>
  google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor="$3" --window-size=$VIEW,1400 \
    --screenshot="$2" "$1" >/dev/null 2>&1
}

for i in 0 1 2 3 4; do
  node "$here/render-html.js" "$scenes/scene$i" "$work/scene$i.html" dark $VIEW >/dev/null
  shot "$work/scene$i.html" "$work/frame$i.png" 1
done

# Stills from the finished scene
node "$here/render-html.js" "$scenes/scene4" "$work/hero.html" dark $VIEW >/dev/null
node "$here/render-html.js" "$scenes/scene4" "$work/light.html" light $VIEW >/dev/null
shot "$work/hero.html" "$work/hero.png" 2
shot "$work/light.html" "$work/light.png" 2

python3 "$here/crop.py" "$work" "$repo/media"

# The animation: one second per scene, held longer on the last
ffmpeg -y -loglevel error -framerate 1 -i "$work/anim%d.png" \
  -filter_complex "[0:v]scale=460:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$repo/media/demo.gif"
ls -la "$repo/media"
