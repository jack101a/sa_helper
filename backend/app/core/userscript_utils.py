import re

def parse_userscript_meta(code: str) -> dict:
    """
    Parses the ==UserScript== metadata block from a userscript's source code.
    Returns a dictionary containing name, version, description, matches, exclude, and runAt.
    """
    meta = {
        "name": "",
        "version": "0.0.0",
        "description": "",
        "namespace": "",
        "icon": "",
        "downloadURL": "",
        "updateURL": "",
        "matches": [],
        "includes": [],
        "exclude": [],
        "excludeMatches": [],
        "requires": [],
        "resources": [],
        "grants": [],
        "connects": [],
        "tags": [],
        "noframes": False,
        "runAt": "document-idle",
        "diagnostics": {
            "warnings": [],
            "errors": [],
        },
    }
    warnings = meta["diagnostics"]["warnings"]
    errors = meta["diagnostics"]["errors"]
    if not isinstance(code, str) or not code.strip():
        errors.append("Userscript code is empty.")
        return meta

    block = re.search(r"//\s*==UserScript==([\s\S]*?)//\s*==/UserScript==", code)
    if not block:
        warnings.append("Missing ==UserScript== metadata block; admin defaults may be applied.")
        return meta
    
    for line in block.group(1).splitlines():
        entry = re.match(r"\s*//\s*@([\w-]+)\s*(.*)", line)
        if not entry:
            continue
        
        key = entry.group(1).strip().lower()
        val = entry.group(2).strip()
        
        if key == "match":
            if val:
                meta["matches"].append(val)
            else:
                warnings.append("Ignored empty @match rule.")
        elif key == "include":
            if val:
                meta["includes"].append(val)
            else:
                warnings.append("Ignored empty @include rule.")
        elif key == "exclude":
            if val:
                meta["exclude"].append(val)
            else:
                warnings.append("Ignored empty @exclude rule.")
        elif key == "exclude-match":
            if val:
                meta["excludeMatches"].append(val)
            else:
                warnings.append("Ignored empty @exclude-match rule.")
        elif key == "require":
            if val:
                meta["requires"].append(val)
            else:
                warnings.append("Ignored empty @require URL.")
        elif key == "resource":
            parts = val.split(None, 1)
            if len(parts) == 2:
                meta["resources"].append({"name": parts[0], "url": parts[1]})
            else:
                warnings.append(f"Ignored invalid @resource entry: {val or '<empty>'}")
        elif key == "grant":
            if val:
                meta["grants"].append(val)
        elif key == "connect":
            if val:
                meta["connects"].append(val)
        elif key == "tag":
            if val:
                meta["tags"].extend(item.strip() for item in re.split(r"[,;\s]+", val) if item.strip())
        elif key == "noframes":
            meta["noframes"] = True
        elif key == "run-at":
            if val in {"document-start", "document-end", "document-idle"}:
                meta["runAt"] = val
            else:
                warnings.append(f"Unsupported @run-at value '{val}', using document-idle.")
        elif key == "name":
            meta["name"] = val
        elif key == "namespace":
            meta["namespace"] = val
        elif key == "version":
            meta["version"] = val
        elif key == "description":
            meta["description"] = val
        elif key == "icon":
            meta["icon"] = val
        elif key == "downloadurl":
            meta["downloadURL"] = val
        elif key == "updateurl":
            meta["updateURL"] = val
    
    if not meta["name"]:
        warnings.append("Missing @name; admin request must provide a name.")
    if not meta["matches"] and not meta["includes"]:
        warnings.append("No @match or @include rules found; admin defaults may use <all_urls>.")

    return meta
