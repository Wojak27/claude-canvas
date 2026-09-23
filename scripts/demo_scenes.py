#!/usr/bin/env python3
"""Build the demo canvas folders used for the README screenshots.

Five cumulative scenes: a piece of work starting, running, and finishing, so the
animation shows the board changing rather than five unrelated pictures.
"""
import os, sys, shutil
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/canvas-scenes"
W, H = 800, 400


def chart(path, upto):
    """A training-loss chart, drawn up to `upto` of 50 epochs."""
    img = Image.new("RGB", (W, H), "#161a1f")
    d = ImageDraw.Draw(img)
    pad_l, pad_b, pad_t, pad_r = 70, 56, 30, 30
    x0, y0, x1, y1 = pad_l, pad_t, W - pad_r, H - pad_b
    for i in range(5):
        y = y0 + (y1 - y0) * i / 4
        d.line([(x0, y), (x1, y)], fill="#232830", width=1)
        d.text((22, y - 7), ["1.0", "0.8", "0.5", "0.3", "0.0"][i], fill="#6b7480")  # loss, high at top
    d.line([(x0, y1), (x1, y1)], fill="#3a424d", width=2)
    d.line([(x0, y0), (x0, y1)], fill="#3a424d", width=2)

    def curve(n, scale, jitter):
        pts = []
        for e in range(n + 1):
            t = e / 50
            v = scale * (0.12 + 0.88 * (2.718 ** (-3.4 * t))) + jitter * ((e * 37) % 11) / 11 * 0.02
            pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * (1 - v)))
        return pts

    if upto >= 1:
        d.line(curve(upto, 1.0, 1), fill="#4daafc", width=3, joint="curve")
        d.line(curve(upto, 1.18, 2), fill="#f0883e", width=2, joint="curve")
    d.text((x0 + 8, y0 + 4), "train", fill="#4daafc")
    d.text((x0 + 58, y0 + 4), "val", fill="#f0883e")
    d.text((W // 2 - 40, H - 26), "epoch", fill="#6b7480")
    img.save(path)


def depth(path):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        v = 26 + 120 * (y / H)
        d.line([(0, y), (W, y)], fill=(int(v * 0.5), int(v * 0.68), int(min(255, v * 1.15))))
    for (bx, by, bw, bh, tone) in [(80, 150, 180, 170, 210), (330, 200, 150, 120, 168), (560, 110, 160, 210, 238)]:
        d.rectangle([bx, by, bx + bw, by + bh],
                    fill=(int(tone * 0.55), int(tone * 0.72), min(255, tone)),
                    outline=(255, 255, 255), width=2)
    d.text((18, 16), "depth · frame 412", fill="#dbe7ff")
    img.save(path)


SESSION = "2026-09-23 — depth head v5"

TASKS = [
    ("Re-render the training set with mixed assets", "@claude"),
    ("Train the head, 3 000 frames", "@claude"),
    ("Eval against the held-out real photos", "@claude"),
    ("Decide whether v5 replaces v4", "@karol"),
]


def tasks_md(done):
    rows = "".join("- [%s] %s %s\n" % ("x" if i < done else " ", t, who) for i, (t, who) in enumerate(TASKS))
    return ("# Tasks\n\n## %s\n%s\n## 2026-09-22 — benchmark harness\n"
            "- [x] Zero-shot bake-off across three models\n- [x] Write up the numbers\n" % (SESSION, rows))


def state_md(phase):
    blocks = {
        0: ("# Starting the run\n\n```progress\nRender: 8 | 240 / 3 000 frames\nTrain: 0 | queued\nEval: 0 | queued\n```\n\n"
            "Kicking off the render. I keep this block current, so the panel is the status.\n"),
        1: ("# Rendering\n\n```progress\nRender: 100 | 3 000 frames\nTrain: 12 | epoch 6/50\nEval: 0 | queued\n```\n\n"
            "Render done, training started on the 4090.\n"),
        2: ("# Training\n\n```progress\nRender: 100 | 3 000 frames\nTrain: 68 | epoch 34/50, 41 min left\nEval: 0 | queued\n```\n\n"
            "Loss is still falling. I will put the curve on the board at epoch 40.\n"),
        3: ("# Training\n\n```progress\nRender: 100 | 3 000 frames\nTrain: 96 | epoch 48/50\nEval: 30 | 180 / 600 photos\n```\n\n"
            "Curve flattened around epoch 40 — eval started early on the finished checkpoint.\n"),
        4: ("# Done\n\n```progress\nRender: 100 | 3 000 frames\nTrain: 100 | 50 epochs\nEval: 100 | 600 photos\n```\n\n"
            "v5 beats v4 on synthetic by 6 points but loses 2 on the real photos. Your call — the\n"
            "comparison is on the board.\n"),
    }
    return blocks[phase]


def build():
    shutil.rmtree(OUT, ignore_errors=True)
    for scene in range(5):
        root = os.path.join(OUT, "scene%d" % scene, ".claude", "canvas")
        feed = os.path.join(root, "feed")
        os.makedirs(feed)
        open(os.path.join(root, "tasks.md"), "w").write(tasks_md([0, 1, 1, 2, 3][scene]))
        open(os.path.join(root, "state.md"), "w").write(state_md(scene))

        if scene >= 2:
            depth(os.path.join(feed, "20260923-141800-000-depth-frame.png"))
            open(os.path.join(feed, "20260923-141800-000-depth-frame.caption.md"), "w").write(
                "Depth on a held-out frame — the far pallet is the one v4 missed.\n")
        if scene >= 3:
            chart(os.path.join(feed, "20260923-142600-000-loss-curve.png"), 40 if scene == 3 else 50)
            open(os.path.join(feed, "20260923-142600-000-loss-curve.caption.md"), "w").write(
                "Training loss, %s epochs.\n" % (40 if scene == 3 else 50))
        if scene >= 4:
            open(os.path.join(feed, "20260923-143100-000-v4-vs-v5.md"), "w").write(
                "## v4 vs v5\n\n| split | v4 | v5 |\n|---|---|---|\n"
                "| synthetic val | 0.77 | **0.83** |\n| real photos | **0.43** | 0.41 |\n\n"
                "- [x] Mixed-asset draw confirmed\n- [ ] Try a real-photo fine-tune pass\n")
    print(OUT)


if __name__ == "__main__":
    build()
