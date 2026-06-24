"""[CLI] The maintenance scripts under app/scripts/ (previously 0% covered).

Run them as real subprocesses (their actual entry points) against the live DB.
  - export_to_disk: fast (writes markdown), always run.
  - backfill_embeddings: re-embeds every page (~minute), gated behind WIKI_RUN_SLOW.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess

import pytest

from tests.conftest import publish_page


def _run(module: str, *args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    # By default run the script as its real entry point (`python -m module`).
    # During a coverage measurement, the parent sets WIKI_COV_SUBPROC so we
    # instead launch under `coverage run` (sysmon core, to trace the async
    # body) — otherwise the subprocess's lines never reach the combined data
    # and these scripts read as 0% despite being exercised here.
    rc = os.environ.get("WIKI_COV_SUBPROC")
    if rc:
        cmd = ["coverage", "run", "--parallel-mode", "--source=app", "-m", module, *args]
        env = {**os.environ, "COVERAGE_CORE": "sysmon"}
    else:
        cmd = ["python", "-m", module, *args]
        env = None
    return subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, cwd="/app", env=env,
    )


def test_export_to_disk_writes_published_pages(tmp_path, contributor):
    # Publish a known page first so the assertion holds regardless of whether
    # the example vault was seeded. (CI runs unseeded — this previously relied
    # on the seeded people/aristotle.md and failed there.)
    p = publish_page(
        contributor, title="Export Probe", body="exported content body", stability="open"
    )

    target = str(tmp_path / "vault-export")
    r = _run("app.scripts.export_to_disk", target)
    assert r.returncode == 0, r.stderr
    assert "Exported" in r.stdout, r.stdout
    mds = glob.glob(os.path.join(target, "**", "*.md"), recursive=True)
    assert len(mds) > 0, "export produced no markdown files"
    # the page we just published round-trips to disk with frontmatter
    probe = os.path.join(target, *p["path"].split("/")) + ".md"
    assert os.path.exists(probe), f"expected {p['path']}.md in the export"
    assert "title:" in open(probe, encoding="utf-8").read()
    shutil.rmtree(target, ignore_errors=True)


@pytest.mark.skipif(
    os.environ.get("WIKI_RUN_SLOW") != "1",
    reason="re-embeds every page (~minute); set WIKI_RUN_SLOW=1",
)
def test_backfill_embeddings_runs_clean():
    r = _run("app.scripts.backfill_embeddings", timeout=600)
    assert r.returncode == 0, r.stderr
    assert "Done. Reindexed" in (r.stdout + r.stderr)
