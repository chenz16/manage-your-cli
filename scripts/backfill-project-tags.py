#!/usr/bin/env python3
"""
One-shot backfill: tag all dynamicStaff with project:{default_project_id}
if they don't already have any project: tag.

Uses the live API (PATCH /api/v1/staff/:id with tags) so the running server's
in-memory state is updated correctly.

Reads default project id from GET /api/v1/secretary-projects.

Usage:
    python3 scripts/backfill-project-tags.py [--base-url http://localhost:3110]
"""
import json
import sys
import urllib.request
import urllib.error
import argparse


def api(base_url: str, path: str, method: str = "GET", body=None):
    url = base_url.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code} {method} {path}: {body_text}") from e


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:3110")
    args = parser.parse_args()
    base = args.base_url

    # Get default project id.
    projects_resp = api(base, "/api/v1/secretary-projects")
    items = projects_resp.get("items", [])
    if not items:
        print("No secretary projects found — start server to trigger migration.", file=sys.stderr)
        sys.exit(1)

    default_project = items[0]
    default_project_id = default_project["id"]
    default_project_name = default_project["name"]
    project_tag = f"project:{default_project_id}"
    print(f"Default project: {default_project_name!r} ({default_project_id})")

    # Get all staff.
    staff_resp = api(base, "/api/v1/staff")
    all_staff = staff_resp.get("items", [])
    print(f"Total staff: {len(all_staff)}")

    tagged_count = 0
    skipped_count = 0

    for s in all_staff:
        staff_id = s["id"]
        name = s.get("name", "?")
        tags = s.get("tags") or []
        has_project_tag = any(t.startswith("project:") for t in tags)
        if has_project_tag:
            skipped_count += 1
            continue

        new_tags = list(tags) + [project_tag]
        try:
            api(base, f"/api/v1/staff/{staff_id}", method="PATCH", body={"tags": new_tags})
            print(f"  Tagged {name!r} ({staff_id[:20]}...)")
            tagged_count += 1
        except RuntimeError as e:
            print(f"  ERROR tagging {name!r}: {e}", file=sys.stderr)

    print(f"\nDone: {tagged_count} tagged, {skipped_count} already had project tag.")


if __name__ == "__main__":
    main()
