"""WCAG 2.1 contrast checker for widget colors.

    python tools/contrast.py "#1B2430" "#FFFFFF"     one pair: ratio and pass/fail for text and UI parts
    python tools/contrast.py --tokens                check every token pair of the skill (light and dark)

Thresholds: body text 4.5 (AA) / 7 (AAA), large text (>= 18.66 px bold or 24 px) 3, UI components (input borders,
icons, focus rings) 3. Decorative borders and disabled text are exempt.
"""
import sys


def luminance(hex_color):
    h = hex_color.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError("use #RRGGBB: %s" % hex_color)
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


THEMES = {
    "light": {
        "surfaces": {"canvas": "#F3F5F8", "surface": "#FFFFFF", "surfaceSunken": "#F6F8FB", "surfaceTint": "#EEF3FB"},
        "text": {"text": 7.0, "textMuted": 4.5, "primary": 4.5, "danger": 4.5, "success": 4.5, "warningText": 4.5},
        "colors": {"text": "#1B2430", "textMuted": "#4F5B69", "primary": "#1558B0", "danger": "#B42318",
                   "success": "#18794E", "warningText": "#8A4600"},
        "ui": [("borderStrong", "#808C9A", 3.0)],
        "pairs": [("onPrimary on primary", "#FFFFFF", "#1558B0", 4.5), ("onDanger on danger", "#FFFFFF", "#B42318", 4.5),
                  ("warningText on warningBg", "#8A4600", "#FFF4E5", 4.5)],
    },
    "dark": {
        "surfaces": {"canvas": "#0F141A", "surface": "#171E26", "surfaceSunken": "#121820", "surfaceTint": "#1A2635"},
        "text": {"text": 7.0, "textMuted": 4.5, "primary": 4.5, "danger": 4.5, "success": 4.5, "warningText": 4.5},
        "colors": {"text": "#E7ECF2", "textMuted": "#AAB4C0", "primary": "#7FB2FF", "danger": "#FF8A80",
                   "success": "#5FD39A", "warningText": "#FFC266"},
        "ui": [("borderStrong", "#6C7A89", 3.0)],
        "pairs": [("onPrimary on primary", "#0B1A2E", "#7FB2FF", 4.5), ("onDanger on danger", "#0B1A2E", "#FF8A80", 4.5),
                  ("warningText on warningBg", "#FFC266", "#3A2A10", 4.5)],
    },
}


def check_tokens():
    failed = 0
    for name, t in THEMES.items():
        print("== %s" % name)
        for token, minimum in t["text"].items():
            for sname, sval in t["surfaces"].items():
                r = ratio(t["colors"][token], sval)
                ok = r >= minimum
                failed += not ok
                print("%-4s %-12s on %-14s %5.2f (min %.1f)" % ("ok" if ok else "FAIL", token, sname, r, minimum))
        for token, color, minimum in t["ui"]:
            for sname, sval in t["surfaces"].items():
                r = ratio(color, sval)
                ok = r >= minimum
                failed += not ok
                print("%-4s %-12s on %-14s %5.2f (min %.1f, UI)" % ("ok" if ok else "FAIL", token, sname, r, minimum))
        for label, fg, bg, minimum in t["pairs"]:
            r = ratio(fg, bg)
            ok = r >= minimum
            failed += not ok
            print("%-4s %-30s %5.2f (min %.1f)" % ("ok" if ok else "FAIL", label, r, minimum))
    print("FAILED: %d" % failed if failed else "ALL PASS")
    return 1 if failed else 0


def main(argv):
    if len(argv) == 2 and argv[1] == "--tokens":
        return check_tokens()
    if len(argv) != 3:
        print(__doc__)
        return 2
    r = ratio(argv[1], argv[2])
    print("ratio %.2f : 1" % r)
    for label, minimum in (("body text AA", 4.5), ("body text AAA", 7.0), ("large text", 3.0), ("UI component", 3.0)):
        print("%-14s %s (min %.1f)" % (label, "pass" if r >= minimum else "FAIL", minimum))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
