"""Exercise deployment guards without network, Docker mutations or real secrets."""

import importlib.util
import runpy
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
GUARD = ROOT / "deploy/check-release.sh"
VALIDATOR = ROOT / "deploy/validate-env.py"
SPEC = importlib.util.spec_from_file_location("validate_env", VALIDATOR)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


@pytest.fixture
def release_repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-b", "main")
    git(tmp_path, "config", "user.name", "Deployment Test")
    git(tmp_path, "config", "user.email", "test@example.invalid")
    git(tmp_path, "commit", "--allow-empty", "-m", "initial")
    git(tmp_path, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(tmp_path, "tag", "1.2.3")
    return tmp_path


def guard(repo: Path, tag: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", str(GUARD), tag], cwd=repo, capture_output=True, text=True)


def test_valid_release_and_ancestor(release_repo: Path) -> None:
    assert guard(release_repo, "1.2.3").stdout.strip() == git(release_repo, "rev-parse", "HEAD")
    git(release_repo, "commit", "--allow-empty", "-m", "next main")
    git(release_repo, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(release_repo, "checkout", "1.2.3")
    assert guard(release_repo, "1.2.3").returncode == 0


@pytest.mark.parametrize("tag", ["", "main", "v1.2.3", "01.2.3", "1.2", "1.2.3-beta", "1.2.3;id"])
def test_bad_tag(release_repo: Path, tag: str) -> None:
    assert guard(release_repo, tag).returncode != 0


def test_unmerged_tag(release_repo: Path) -> None:
    git(release_repo, "commit", "--allow-empty", "-m", "not in main")
    git(release_repo, "tag", "1.2.4")
    assert guard(release_repo, "1.2.4").returncode != 0


def test_wrong_checkout_missing_tag_and_dirty_tree(release_repo: Path) -> None:
    assert guard(release_repo, "1.2.4").returncode != 0
    git(release_repo, "commit", "--allow-empty", "-m", "different checkout")
    assert guard(release_repo, "1.2.3").returncode != 0
    git(release_repo, "checkout", "1.2.3")
    (release_repo / "dirty").write_text("untracked")
    assert guard(release_repo, "1.2.3").returncode != 0


def test_missing_main(release_repo: Path) -> None:
    git(release_repo, "update-ref", "-d", "refs/remotes/origin/main")
    assert guard(release_repo, "1.2.3").returncode != 0


ENV = "BOT_TOKEN=123456:" + "a" * 35 + "\nPOSTGRES_PASSWORD=" + "a" * 64 + "\nACME_AGREE_TOS=yes\n"


@pytest.mark.parametrize(
    "contents,valid",
    [
        (ENV, True),
        ("# comment\n\n" + ENV, True),
        ("", False),
        (ENV + "BOT_TOKEN=duplicate\n", False),
        (ENV + "unexpected=value\n", False),
        (ENV + "invalid\n", False),
        (ENV.replace("ACME_AGREE_TOS=yes", "ACME_AGREE_TOS=no"), False),
        (ENV.replace("123456:", "bad:"), False),
        (ENV.replace("a" * 64, "password@host"), False),
        (ENV.replace("a" * 35, "$(command)"), False),
    ],
)
def test_environment_validation(contents: str, valid: bool) -> None:
    assert MODULE.validate(contents) is valid


def test_validator_cli_never_discloses_input(tmp_path: Path) -> None:
    path = tmp_path / "runtime.env"
    for contents, status in [(ENV, 0), ("SECRET-DO-NOT-LOG", 1)]:
        path.write_text(contents)
        result = subprocess.run(
            [sys.executable, str(VALIDATOR), str(path)], capture_output=True, text=True
        )
        assert result.returncode == status
        assert "SECRET-DO-NOT-LOG" not in result.stdout + result.stderr
        assert "123456:" not in result.stdout + result.stderr


def test_validator_entrypoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "runtime.env"
    monkeypatch.setattr(sys, "argv", [str(VALIDATOR), str(path)])
    path.write_text(ENV)
    runpy.run_path(str(VALIDATOR), run_name="__main__")
    path.write_text("invalid")
    with pytest.raises(SystemExit, match="Invalid runtime.env"):
        runpy.run_path(str(VALIDATOR), run_name="__main__")


def test_runtime_snapshot_matches_existing_pins() -> None:
    prod = set((ROOT / "requirements-prod.lock").read_text().splitlines()[1:])
    dev = set((ROOT / "requirements-dev.lock").read_text().splitlines())
    assert prod <= dev
    assert not any(pin.startswith(("pytest", "mypy", "ruff")) for pin in prod)
