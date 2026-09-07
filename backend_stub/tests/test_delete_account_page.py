"""Google Play Data safety deletion page must exist on the marketing site."""

from pathlib import Path

PAGE = Path(__file__).resolve().parents[2] / "frontend" / "delete-account.html"


def test_delete_account_page_exists_for_play_store() -> None:
    text = PAGE.read_text(encoding="utf-8")
    assert PAGE.is_file()
    assert "Delete your account and data" in text
    assert "support@shiftswifthr.co.uk" in text
    assert "within 30 days" in text
    assert "co.uk.shiftswifthr.app" in text
    assert 'canonical" href="https://www.shiftswifthr.co.uk/delete-account.html"' in text


def test_www_deploy_allowlist_includes_delete_account() -> None:
    script = Path(__file__).resolve().parents[2] / "deploy" / "cloudpanel" / "pull-production.sh"
    content = script.read_text(encoding="utf-8")
    assert "--include='delete-account.html'" in content
    assert "delete-account.html" in content.split("LEGAL_PAGES=")[1].split(")" )[0]
