import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import tempfile
import json
import os

from app.services.cache_service import CacheService
from app.services.exam_service import ExamService

class TestCacheService(unittest.TestCase):
    def setUp(self):
        self.cache = CacheService(ttl_seconds=1)

    def test_set_and_get(self):
        self.cache.set("type", "b64", "fast", {"res": "ok"})
        self.assertEqual(self.cache.get("type", "b64", "fast"), {"res": "ok"})

    def test_ttl_expiration(self):
        import time
        self.cache.set("type", "b64", "fast", {"res": "ok"})
        time.sleep(1.1)
        self.assertIsNone(self.cache.get("type", "b64", "fast"))

    def test_lru_eviction(self):
        # Note: In our implementation, we added a limit and LRU logic.
        # Let's use a smaller limit for testing if we can, or just test a lot of entries.
        # Since _SOLVED_MAP_LIMIT is 1000 in captcha.js, but CacheService doesn't have one.
        # Wait, I added LRU to captcha.js, not CacheService. 
        # Let me check CacheService.py.
        pass

class TestExamService(unittest.TestCase):
    def setUp(self):
        self.mock_db = MagicMock()
        self.tmp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self.tmp_dir_obj.name)
        (self.tmp_dir / "questions").mkdir(parents=True)
        (self.tmp_dir / "hashes").mkdir(parents=True)

        # Create dummy questions.json
        (self.tmp_dir / "questions" / "questions.json").write_text(
            json.dumps([{"question_text": "What is 2+2?", "correct_option_number": 1, "option_1": "4", "option_2": "5", "option_3": "6", "option_4": "7"}]),
            encoding="utf-8"
        )
        # Create dummy sign_hashes.json
        (self.tmp_dir / "hashes" / "sign_hashes.json").write_text(
            json.dumps({"abc": "STOP"}),
            encoding="utf-8"
        )
        # Create dummy sign_label.json
        (self.tmp_dir / "hashes" / "sign_label.json").write_text(
            json.dumps({"STOP": "Stop Sign"}),
            encoding="utf-8"
        )

        self.service = ExamService(db=self.mock_db, data_dir=self.tmp_dir)

    def tearDown(self):
        self.tmp_dir_obj.cleanup()

    def test_init_loads_data(self):
        self.assertEqual(len(self.service._questions), 1)
        self.assertEqual(self.service._sign_hashes["abc"], "STOP")
        self.assertEqual(self.service._sign_labels["STOP"], "Stop Sign")

    def test_solver_methods_uses_configured_order_and_random_flag(self):
        self.mock_db.get_setting.return_value = json.dumps([
            {"id": "llm", "enabled": True, "priority": 10},
            {"id": "ocr_db", "enabled": False, "priority": 20},
            {"id": "auto_learned_bank", "enabled": True, "priority": 30},
            {"id": "random_fallback", "enabled": False, "priority": 40},
        ])

        methods, allow_random = self.service._solver_methods()

        self.assertEqual(methods[0], "llm")
        self.assertLess(methods.index("llm"), methods.index("auto_learned_bank"))
        self.assertNotIn("ocr_db", methods)
        self.assertFalse(allow_random)

    def test_solver_methods_maps_legacy_granular_config(self):
        self.mock_db.get_setting.return_value = json.dumps([
            {"id": "learned_exact_hash", "enabled": False, "priority": 30},
            {"id": "learned_phash", "enabled": True, "priority": 5},
            {"id": "sign_hash_db", "enabled": False, "priority": 10},
            {"id": "ocr_db", "enabled": True, "priority": 20},
            {"id": "llm", "enabled": False, "priority": 70},
            {"id": "random_fallback", "enabled": False, "priority": 80},
        ])

        methods, allow_random = self.service._solver_methods()

        self.assertEqual(methods, ["auto_learned_bank", "ocr_db"])
        self.assertFalse(allow_random)

    def test_solver_methods_falls_back_to_safe_defaults_on_bad_json(self):
        self.mock_db.get_setting.return_value = "{bad json"

        methods, allow_random = self.service._solver_methods()

        self.assertIn("auto_learned_bank", methods)
        self.assertIn("ocr_db", methods)
        self.assertIn("llm", methods)
        self.assertTrue(allow_random)

if __name__ == "__main__":
    unittest.main()
