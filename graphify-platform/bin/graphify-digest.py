#!/usr/bin/env python3
"""
graphify-digest.py

Emits a 150-200 token TL;DR digest from graphify-out/ for session-start lazy-loading.
Replaces full GRAPH_REPORT.md read (5,567 tokens) with a compact summary that lets
Claude decide whether to pull the full report.

Output: graphify-out/_GRAPHIFY_DIGEST.md  (~800 chars / ~200 tokens)

Usage:
  ./graphify-digest.py <path-to-graphify-out>

Rationale:
  - Full GRAPH_REPORT.md = 5,567 tokens. Only ~10% of sessions actually need it.
  - Digest gives: nodes/edges count, top 5 god-nodes, top 5 communities, freshness.
  - Claude reads digest on session start (cheap) → pulls full report only when asked
    architectural questions (lazy).
  - Net: ~96% reduction on session-init token cost.

Hard rules:
  - Reads only graph.json (never source).
  - Writes only _GRAPHIFY_DIGEST.md inside graphify-out/.
  - Idempotent.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

DIGEST_NAME = "_GRAPHIFY_DIGEST.md"

# Denylist: framework boilerplate + unresolved accessor calls.
# Without this, top god-nodes get dominated by Next.js route handler exports
# (GET/POST/PUT/DELETE/PATCH/OPTIONS/HEAD) and unresolved method calls (.get, .set,
# .fetch, .map, etc.) that have no business semantics. Filtering them surfaces real
# domain functions like findBestGladiator, executeTrade, karmaBuilder.
FILE_EXTS = (".ts", ".py", ".js", ".tsx", ".jsx", ".mjs", ".cjs")
HTTP_EXPORTS = {
    "GET", "GET()", "POST", "POST()", "PUT", "PUT()", "DELETE", "DELETE()",
    "PATCH", "PATCH()", "OPTIONS", "OPTIONS()", "HEAD", "HEAD()",
}
GENERIC_HANDLERS = {
    "default", "default()", "handler", "handler()", "middleware", "middleware()",
    "constructor", "constructor()", "render", "render()",
}


def _is_noise_label(label: str) -> bool:
    """Return True if label is framework boilerplate, unresolved call, or file node."""
    if not label:
        return True
    if any(label.endswith(ext) for ext in FILE_EXTS):
        return True
    if label in HTTP_EXPORTS or label in GENERIC_HANDLERS:
        return True
    # Unresolved method calls show up as ".methodname" or ".methodname()"
    if label.startswith("."):
        return True
    return False


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Graphify TL;DR digest generator")
    p.add_argument("graphify_out", type=Path, help="Path to graphify-out/")
    p.add_argument("--top-gods", type=int, default=5, help="Top god-nodes (default 5)")
    p.add_argument("--top-comms", type=int, default=5, help="Top communities (default 5)")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    out_dir: Path = args.graphify_out.resolve()
    fp = out_dir / "graph.json"
    if not fp.is_file():
        sys.stderr.write(f"[digest] FATAL: graph.json missing at {fp}\n")
        return 1

    with fp.open("r", encoding="utf-8") as f:
        graph = json.load(f)

    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    if not nodes:
        sys.stderr.write("[digest] FATAL: 0 nodes in graph\n")
        return 1

    # Degree count for god-nodes
    deg: Counter[str] = Counter()
    for link in links:
        s, t = link.get("_src"), link.get("_tgt")
        if s:
            deg[s] += 1
        if t and t != s:
            deg[t] += 1

    # Resolve top god-nodes (use label, not id)
    id_to_label = {n["id"]: n.get("label", n["id"]) for n in nodes}
    top_gods = []
    # Buffer 6x because filtering can be aggressive on noisy graphs
    for nid, d in deg.most_common(args.top_gods * 6):
        label = id_to_label.get(nid, nid)
        if _is_noise_label(label):
            continue
        top_gods.append((label, d))
        if len(top_gods) >= args.top_gods:
            break

    # Community sizes
    by_comm: dict[int, int] = defaultdict(int)
    for n in nodes:
        cid = n.get("community")
        if cid is not None:
            by_comm[cid] += 1
    top_comms = sorted(by_comm.items(), key=lambda kv: -kv[1])[: args.top_comms]

    # Freshness
    age_days = "?"
    try:
        mtime = fp.stat().st_mtime
        age_seconds = datetime.now().timestamp() - mtime
        age_days = f"{int(age_seconds / 86400)}d"
    except OSError:
        pass

    # Compose digest (target: ~150-200 tokens)
    lines = [
        "# Graphify Digest (session-start TL;DR)",
        "",
        f"_age={age_days} · {len(nodes)} nodes · {len(links)} edges · {len(by_comm)} communities_",
        "",
        "**Top god-nodes (by degree):**",
    ]
    for label, d in top_gods:
        lines.append(f"- `{label}` ({d})")
    lines += ["", "**Top communities (by size):**"]
    for cid, size in top_comms:
        lines.append(f"- C{cid}: {size} nodes → [[_COMMUNITY_Community {cid}]]")
    lines += [
        "",
        "**Full map:** [[GRAPH_REPORT|GRAPH_REPORT.md]] (~5.5k tokens)",
        "**Index:** [[_GRAPHIFY_INDEX]] (all 80 communities)",
        "",
        f"_Generated by graphify-digest · {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}_",
        "",
    ]
    body = "\n".join(lines)
    (out_dir / DIGEST_NAME).write_text(body, encoding="utf-8")
    print(f"[digest] OK · wrote {DIGEST_NAME} ({len(body)} chars · ~{len(body) // 4} tokens)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
