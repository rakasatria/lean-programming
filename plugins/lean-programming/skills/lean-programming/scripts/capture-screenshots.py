#!/usr/bin/env python3
"""Minimal Playwright screenshot capture helper for lean-programming releases.

Run offline when cached:
  uv run --offline --with playwright python3 capture-screenshots.py --manifest shots.json --out-dir docs/assets/releases/v0.19.0
Or single URL:
  uv run --offline --with playwright python3 capture-screenshots.py --url http://127.0.0.1:9000/login --out docs/assets/releases/v0.19.0/01-login.png
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def parse_viewport(val: str | dict | None) -> dict[str, int]:
    if not val:
        return {"width": 1440, "height": 900}
    if isinstance(val, dict):
        return {"width": int(val["width"]), "height": int(val["height"])}
    w, h = str(val).lower().split("x", 1)
    return {"width": int(w), "height": int(h)}


def find_chromium_executable() -> str | None:
    cache_root = Path(
        os.environ.get("PLAYWRIGHT_BROWSERS_PATH", str(Path.home() / ".cache/ms-playwright"))
    )
    if not cache_root.exists():
        return None
    patterns = [
        "chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
        "chromium-*/chrome-linux64/chrome",
    ]
    for pat in patterns:
        matches = sorted(cache_root.glob(pat), reverse=True)
        if matches and matches[0].is_file():
            return str(matches[0])
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Capture release screenshots with Playwright.")
    ap.add_argument("--manifest", help="JSON file: {base_url?, login?, shots: [{name, url, ...}]}")
    ap.add_argument("--out-dir", help="Output directory when using --manifest")
    ap.add_argument("--url", help="Single URL to capture")
    ap.add_argument("--out", help="Single output PNG path")
    ap.add_argument("--viewport", default="1440x900", help="Default WxH (e.g. 1440x900 or 390x844)")
    ap.add_argument("--full-page", action="store_true", help="Capture full scrollable page")
    ap.add_argument("--wait-ms", type=int, default=200, help="Post-load settle delay in ms")
    ap.add_argument("--check-overflow", action="store_true", help="Report horizontal scroll overflow")
    args = ap.parse_args()

    if not args.manifest and not (args.url and args.out):
        ap.error("Provide either --manifest (+ --out-dir) or both --url and --out.")

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    if args.manifest:
        spec = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        base_url = spec.get("base_url", "").rstrip("/")
        shots = spec["shots"]
        out_dir = Path(args.out_dir or spec.get("out_dir") or ".")
        login = spec.get("login")
    else:
        base_url = ""
        login = None
        out_path = Path(args.out)
        out_dir = out_path.parent
        shots = [{"name": out_path.name, "url": args.url, "viewport": args.viewport, "full_page": args.full_page}]

    out_dir.mkdir(parents=True, exist_ok=True)
    exe = find_chromium_executable()
    launch_opts: dict = {"headless": True}
    if exe:
        launch_opts["executable_path"] = exe

    overflow_hits = []
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_opts)
        try:
            ctx = browser.new_context(viewport=parse_viewport(args.viewport))
            page = ctx.new_page()

            if login:
                login_url = login["url"]
                if base_url and login_url.startswith("/"):
                    login_url = base_url + login_url
                page.goto(login_url, wait_until="networkidle")
                for step in login.get("steps", []):
                    if "fill" in step:
                        page.fill(step["fill"], step["value"])
                    elif "click" in step:
                        page.click(step["click"])
                    elif "wait_for" in step:
                        page.wait_for_selector(step["wait_for"])
                if login.get("wait_ms"):
                    page.wait_for_timeout(int(login["wait_ms"]))

            for shot in shots:
                vp = parse_viewport(shot.get("viewport", args.viewport))
                page.set_viewport_size(vp)
                if shot.get("cookies"):
                    ctx.add_cookies(shot["cookies"])

                target = shot["url"]
                if base_url and target.startswith("/"):
                    target = base_url + target
                page.goto(target, wait_until="networkidle")

                for click_sel in shot.get("clicks", []):
                    page.click(click_sel)
                if shot.get("wait_for"):
                    page.wait_for_selector(shot["wait_for"])
                delay = int(shot.get("wait_ms", args.wait_ms))
                if delay > 0:
                    page.wait_for_timeout(delay)

                dest = out_dir / shot["name"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(dest), full_page=bool(shot.get("full_page", args.full_page)))

                if args.check_overflow or shot.get("check_overflow"):
                    ov = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
                    if ov:
                        overflow_hits.append(str(dest))

                kb = dest.stat().st_size / 1024.0
                print(f"shot: {dest} ({vp['width']}x{vp['height']}, {kb:.1f} KB)")
        finally:
            browser.close()

    if overflow_hits:
        print("OVERFLOW: " + ", ".join(overflow_hits), file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
