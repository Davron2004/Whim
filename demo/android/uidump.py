#!/usr/bin/env python3
"""Pretty-print `adb exec-out uiautomator dump /dev/tty` XML as one line per node.

Usage:
  adb exec-out uiautomator dump /dev/tty | python3 demo/android/uidump.py
  adb exec-out uiautomator dump /dev/tty | python3 demo/android/uidump.py --clickable

Each line: [idx] class TEXT|desc clickable/long-clickable bounds. Only nodes that carry
text, a content-desc, or (with --clickable) are clickable are listed.
"""
import sys
import xml.etree.ElementTree as ET

show_clickable = "--clickable" in sys.argv
data = sys.stdin.buffer.read().decode("utf-8", errors="replace")
# uiautomator sometimes prefixes garbage before the <?xml prolog.
start = data.find("<?xml")
if start >= 0:
    data = data[start:]
end = data.rfind("</hierarchy>")
if end >= 0:
    data = data[: end + len("</hierarchy>")]
root = ET.fromstring(data)

count = 0


def walk(node):
    global count
    text = (node.get("text") or "").strip()
    desc = (node.get("content-desc") or "").strip()
    clickable = node.get("clickable") == "true"
    longclick = node.get("long-clickable") == "true"
    if text or desc or (show_clickable and clickable):
        label = text or desc
        flags = ("C" if clickable else "-") + ("L" if longclick else "-")
        cls = (node.get("class") or "?").split(".")[-1]
        print(f"[{node.get('index')}] {flags} {cls} {label!r} {node.get('bounds')}")
        count += 1
    for child in node:
        walk(child)


walk(root)
if count == 0:
    print("(no matching nodes)")
