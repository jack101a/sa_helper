import json
import os
import sys
from pathlib import Path

# Add backend to path so we can import app modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.core.config import get_settings
from app.core.database import Database

def seed_default_automation_method():
    settings = get_settings()
    db = Database(settings)
    db.init()
    
    project_root = Path(__file__).parent.parent
    scripts_dir = project_root / "data" / "automation_scripts"
    
    step3_path = scripts_dir / "step3.js"
    step4_path = scripts_dir / "step4.js"
    
    if not step3_path.exists() or not step4_path.exists():
        print("Error: step3.js or step4.js not found in data/automation_scripts")
        return
        
    step3_code = step3_path.read_text(encoding="utf-8")
    step4_code = step4_path.read_text(encoding="utf-8")
    
    payload = {
        "version": 1,
        "mode": "combo",
        "steps": [
            {
                "id": "step3",
                "label": "Step 3 (faceAuthStatus)",
                "code": step3_code,
                "wait_after_ms": 5000
            },
            {
                "id": "step4",
                "label": "Step 4 (saveFaceAuthData)",
                "code": step4_code,
                "wait_after_ms": 0
            }
        ]
    }
    
    payload_json = json.dumps(payload)
    
    # Check if already exists
    existing = db.list_automation_methods(method_type="stall-flow")
    if any(m["name"] == "Default STALL Combo" for m in existing):
        print("Default STALL Combo already exists in database.")
        return
        
    db.create_automation_method(
        name="Default STALL Combo",
        description="Original file-based Step 3 + Step 4 combo flow.",
        method_type="stall-flow",
        payload_json=payload_json
    )
    print("Seeded 'Default STALL Combo' into automation_methods table.")

if __name__ == "__main__":
    seed_default_automation_method()
