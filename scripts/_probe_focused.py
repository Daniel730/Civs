#!/usr/bin/env python3
"""Focused short-context probes with think disabled when supported."""
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:11434"
MODELS = ["hermes-fast-mc", "hermes-agent-mc", "hermes-coder-mc", "hermes-fast", "hermes-agent"]
TOOL_PROMPT = (
    "You have tools: minecraft_observe, minecraft_move_to, "
    "minecraft_rpg_observe, minecraft_rpg_accept.\n"
    "Goal: Investigate whether the player can accept a quest.\n"
    "Return ONLY the next tool call name and arguments JSON. "
    "No hallucinated tools.\n"
    "Format:\nTOOL: <name>\nARGS: {}"
)
RECOVERY = (
    "You called minecraft_rpg_accept ARGS: {\"questId\":\"demo\"}.\n"
    "Result: FAIL {\"status\":\"FAIL\",\"reason\":\"quest not offered\"}.\n"
    "Next tool ONLY from allowed list. Format:\nTOOL: <name>\nARGS: {}"
)
ALLOWED = {
    "minecraft_observe",
    "minecraft_move_to",
    "minecraft_rpg_observe",
    "minecraft_rpg_accept",
}
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": n,
            "description": n,
            "parameters": {"type": "object", "properties": {}},
        },
    }
    for n in sorted(ALLOWED)
]


def post(path, body, timeout=180):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as resp:
        return json.loads(resp.read().decode())


def unload_all():
    for m in get("/api/ps").get("models", []):
        name = m.get("name")
        try:
            post("/api/generate", {"model": name, "keep_alive": 0, "prompt": ""}, 60)
        except Exception as exc:  # noqa: BLE001
            print("unload", name, exc)


def chat(model, prompt, num_predict=64):
    body = {
        "model": model,
        "stream": False,
        "keep_alive": "30s",
        "think": False,
        "options": {"num_ctx": 4096, "num_predict": num_predict, "temperature": 0.1},
        "messages": [{"role": "user", "content": prompt}],
    }
    t0 = time.perf_counter()
    try:
        out = post("/api/chat", body, 240)
        msg = out.get("message") or {}
        return {
            "ok": True,
            "latency_s": round(time.perf_counter() - t0, 2),
            "content": msg.get("content") or "",
            "thinking": (msg.get("thinking") or "")[:120],
            "eval_count": out.get("eval_count"),
            "prompt_eval_count": out.get("prompt_eval_count"),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        # retry without think key if unsupported
        if "think" in str(exc).lower() or True:
            body.pop("think", None)
            t0 = time.perf_counter()
            try:
                out = post("/api/chat", body, 240)
                msg = out.get("message") or {}
                return {
                    "ok": True,
                    "latency_s": round(time.perf_counter() - t0, 2),
                    "content": msg.get("content") or "",
                    "thinking": (msg.get("thinking") or "")[:120],
                    "eval_count": out.get("eval_count"),
                    "prompt_eval_count": out.get("prompt_eval_count"),
                    "error": f"retried_without_or_with_error:{exc}",
                }
            except Exception as exc2:  # noqa: BLE001
                return {"ok": False, "latency_s": round(time.perf_counter() - t0, 2), "error": str(exc2), "content": ""}
        return {"ok": False, "latency_s": round(time.perf_counter() - t0, 2), "error": str(exc), "content": ""}


def tools_api(model, prompt):
    t0 = time.perf_counter()
    try:
        out = post(
            "/v1/chat/completions",
            {
                "model": model,
                "temperature": 0.1,
                "max_tokens": 96,
                "tools": TOOLS,
                "tool_choice": "auto",
                "messages": [{"role": "user", "content": prompt}],
            },
            240,
        )
        msg = (out.get("choices") or [{}])[0].get("message") or {}
        tcs = msg.get("tool_calls") or []
        names = [((t.get("function") or {}).get("name")) for t in tcs]
        return {
            "ok": True,
            "latency_s": round(time.perf_counter() - t0, 2),
            "tool_calls": names,
            "content": (msg.get("content") or "")[:300],
            "native_tools": bool(names),
            "valid": all(n in ALLOWED for n in names) if names else False,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "latency_s": round(time.perf_counter() - t0, 2), "error": str(exc)}


def score(text: str) -> dict:
    t = text or ""
    mentioned = [a for a in ALLOWED if a in t]
    hall = []
    for line in t.splitlines():
        if line.strip().upper().startswith("TOOL:"):
            name = line.split(":", 1)[1].strip().split()[0]
            if name and name not in ALLOWED:
                hall.append(name)
    return {
        "mentioned": mentioned,
        "observe_first": bool(mentioned) and mentioned[0] in ("minecraft_rpg_observe", "minecraft_observe"),
        "hallucinated": hall,
        "preview": t[:240],
    }


def main():
    out_dir = Path("/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner/reports")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    rows = []
    for model in MODELS:
        print("===", model, flush=True)
        unload_all()
        time.sleep(1)
        ping = chat(model, "Reply with exactly PONG and nothing else.", 8)
        tool = chat(model, TOOL_PROMPT, 64)
        rec = chat(model, RECOVERY, 64)
        tapi = tools_api(model, TOOL_PROMPT)
        row = {
            "model": model,
            "ping": ping,
            "tool_text": {**tool, "score": score(tool.get("content") or "")},
            "recovery": {**rec, "score": score(rec.get("content") or "")},
            "openai_tools": tapi,
        }
        rows.append(row)
        print(json.dumps(row, indent=2)[:1200], flush=True)
        unload_all()
    path = out_dir / f"model-probe-focused-{stamp}.json"
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print("WROTE", path)


if __name__ == "__main__":
    main()
