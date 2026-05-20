# Task P7 — Security Hardening

> **Tasks**: T26, T27, T28  
> **Priority**: P7  
> **Depends on**: T16-T19 (tests)  
> **Estimated changes**: ~60 lines modified

---

## Files to Read First

1. `backend/app/middleware/auth_middleware.py` — full file (137 lines)
2. `backend/app/api/admin_routes/utils.py` — `_admin_guard()` and session cookie logic
3. `backend/app/api/routes.py` — lines 500-560 (base64 image handling)
4. `backend/app/core/security.py` — full file (66 lines)

---

## T26: Log Auth Fallthrough at ERROR Level

### Goal

The auth middleware silently falls through from user-key to legacy on exceptions (line 117-119). Make this observable.

**File**: `backend/app/middleware/auth_middleware.py`  
**Location**: Lines 117-119

**Find:**
```python
        except Exception as e:
            logger.warning("user_key_check_failed", extra={"context": {"error": str(e)}})
            return None  # Fall through to legacy on error
```

**Replace with:**
```python
        except Exception as e:
            logger.error(
                "user_key_check_failed_fallthrough",
                extra={"context": {
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "path": path,
                    "api_key_present": bool(api_key),
                }},
            )
            return None  # Fall through to legacy on error
```

---

## T27: Add Image Validation for Base64 Payloads

### Goal

Validate that base64-decoded images are actually valid images before processing, to prevent abuse.

**File**: `backend/app/api/routes.py`

**Find the `_b64_to_pil` utility function** (search for it — it may be in `exam_service.py` or `routes.py`).

**Add size validation** to the function:

```python
def _b64_to_pil(b64: str) -> Image.Image:
    """Decode base64 to PIL Image with validation."""
    import base64
    from io import BytesIO
    from PIL import Image
    
    # Reject oversized payloads (max 5MB base64 = ~3.75MB decoded)
    if len(b64) > 5 * 1024 * 1024:
        raise ValueError("Image payload too large (max 5MB)")
    
    data = base64.b64decode(b64)
    img = Image.open(BytesIO(data))
    
    # Reject oversized images (max 4000x4000 pixels)
    if img.width > 4000 or img.height > 4000:
        raise ValueError(f"Image too large: {img.width}x{img.height} (max 4000x4000)")
    
    return img
```

> **Note**: Search for the function with `grep -rn "_b64_to_pil\|b64_to_pil" backend/app/`. If it's in `exam_service.py`, edit it there. If it doesn't exist as a separate function, find where `base64.b64decode` is called for images and add the validation inline.

---

## T28: Secure Admin Session Cookies

### Goal

Add `SameSite`, `Secure`, and `HttpOnly` flags to admin session cookies.

**File**: `backend/app/api/admin_routes/utils.py`

**Find where the admin session cookie is set** (search for `set_cookie` or `response.cookies`).

**Add security flags:**

```python
# When setting the cookie, ensure these flags are present:
response.set_cookie(
    key="admin_session",          # or whatever the cookie name is
    value=session_token,
    httponly=True,                 # Prevent JS access
    samesite="strict",            # Prevent CSRF
    secure=False,                 # Set to True when using HTTPS
    max_age=86400,                # 24 hours
    path="/admin",                # Scope to admin paths only
)
```

> **Important**: Read the file to find the exact cookie-setting code. The cookie name and value format may differ. Only add the flags — do not change the value computation.

---

## Verification

```bash
# 1. Check auth middleware logging
cd backend && grep -n "error\|ERROR" app/middleware/auth_middleware.py

# 2. Check image validation exists
cd backend && grep -n "too large\|max.*MB\|max.*4000" app/services/exam_service.py app/api/routes.py

# 3. Check cookie security flags
cd backend && grep -n "httponly\|samesite\|secure" app/api/admin_routes/utils.py

# 4. Run tests
cd backend && python -m pytest tests/ -v
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `auth_middleware.py` | ~5 lines — upgrade WARNING to ERROR with more context |
| `exam_service.py` or `routes.py` | ~10 lines — add image size validation |
| `admin_routes/utils.py` | ~5 lines — add cookie security flags |
