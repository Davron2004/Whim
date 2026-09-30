import json
import sys
from pathlib import Path


ACCEPTANCE_DIR = Path(__file__).resolve().parent


def hierarchy_path(arguments: list[str]) -> Path:
    if len(arguments) != 1:
        raise SystemExit('usage: bounds.py <hierarchy.json>')

    path = (ACCEPTANCE_DIR / arguments[0]).resolve()
    try:
        path.relative_to(ACCEPTANCE_DIR)
    except ValueError:
        raise SystemExit('hierarchy JSON must be beneath this acceptance directory')

    if path.suffix != '.json' or not path.is_file():
        raise SystemExit('hierarchy JSON must name an existing file')
    return path


def walk(node):
    attributes = node.get('attributes', {})
    text = attributes.get('accessibilityText') or attributes.get('resource-id') or attributes.get('value')
    if text:
        print(text, attributes.get('bounds'))
    for child in node.get('children', []):
        walk(child)


with hierarchy_path(sys.argv[1:]).open(encoding='utf-8') as hierarchy:
    walk(json.load(hierarchy))
