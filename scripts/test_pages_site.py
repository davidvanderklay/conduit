import tempfile
import unittest
from pathlib import Path

from pages_site import FLATPAK_FILES, assemble_site


class PagesSiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.docs = root / "built-docs"
        self.flatpak = root / "flatpak"
        self.output = root / "pages"
        for name in ("index.html", "search/search_index.json"):
            path = self.docs / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("docs")
        for name in (*FLATPAK_FILES, "repo/objects/ab/release.file", ".git/config"):
            path = self.flatpak / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"\x00signed repository fixture\xff")

    def test_preserves_flatpak_bytes_and_paths_with_docs_alongside(self):
        assemble_site(self.docs, self.flatpak, self.output)
        for path in self.flatpak.rglob("*"):
            if path.is_file() and ".git" not in path.parts:
                published = self.output / path.relative_to(self.flatpak)
                self.assertEqual(path.read_bytes(), published.read_bytes())
        self.assertFalse((self.output / ".git").exists())
        self.assertEqual((self.output / "docs/index.html").read_text(), "docs")
        self.assertTrue((self.output / ".nojekyll").exists())

    def test_missing_signature_fails_before_creating_artifact(self):
        (self.flatpak / "repo/summary.sig").unlink()
        with self.assertRaisesRegex(ValueError, "summary.sig"):
            assemble_site(self.docs, self.flatpak, self.output)
        self.assertFalse(self.output.exists())

    def test_reserved_docs_path_cannot_overwrite_flatpak_files(self):
        (self.flatpak / "docs").mkdir()
        with self.assertRaisesRegex(ValueError, "reserved docs path"):
            assemble_site(self.docs, self.flatpak, self.output)
        self.assertFalse(self.output.exists())

    def test_symlinks_fail_before_creating_artifact(self):
        (self.flatpak / "repo/link").symlink_to("config")
        with self.assertRaisesRegex(ValueError, "symlink"):
            assemble_site(self.docs, self.flatpak, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_output_is_never_replaced(self):
        self.output.mkdir()
        (self.output / "keep").write_text("existing site")
        with self.assertRaises(FileExistsError):
            assemble_site(self.docs, self.flatpak, self.output)
        self.assertEqual((self.output / "keep").read_text(), "existing site")


if __name__ == "__main__":
    unittest.main()
