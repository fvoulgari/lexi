"""Observe the merge gate's exit status for upstream validation outcomes."""

import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class CheckResultsTests(unittest.TestCase):
    def gate(self, **results):
        return subprocess.run(
            ["bash", str(ROOT / "scripts/check-results.sh")],
            env={
                **os.environ,
                "BACKEND_RESULT": "success",
                "FRONTEND_RESULT": "success",
                "PUBLICATION_RESULT": "success",
                **results,
            },
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_all_validations_pass(self):
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_any_unsuccessful_validation_blocks_merging(self):
        for check in ["BACKEND_RESULT", "FRONTEND_RESULT", "PUBLICATION_RESULT"]:
            for status in ["failure", "cancelled", "skipped", "", "unknown"]:
                with self.subTest(check=check, status=status):
                    result = self.gate(**{check: status})
                    self.assertNotEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
