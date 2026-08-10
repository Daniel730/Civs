#!/usr/bin/env python3
"""Empirical Ollama model probes for Minecraft agent role selection.

Writes JSONL results; never invents success. Uses short context to fit RTX 3060 12GB.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:11434"
# Prefer light→heavy; stop loading 14B until light models finish.
MODELS = [
    "hermes-fast",
    "hermes-agent",
    "qwen3.5:9b",
    "gemma4:12b",
    "hermes-coder",
    "hermes-qwen14",
    "qwen3:14b",
]

TOOL_PROMPT = """You have tools: minecraft_observe, minecraft_move_to, minecraft_rpg_observe, minecraft_rpg_accept.
Goal: Investigate whether the player can accept a quest.
Return ONLY the next tool call name and arguments JSON. No hallucinated tools.
Example format:
TOOL: minecraft_rpg_observe
ARGS: {}
"""

RECOVERY_PROMPT = """You called minecraft_rpg_accept with ARGS: {"questId":"demo"}.
Result: FAIL {"status":"FAIL","reason":"quest not offered at this location","observed":{"activeQuests":[]}}
Choose the next tool call ONLY from: minecraft_observe, minecraft_move_to, minecraft_rpg_observe, minecraft_rpg_accept.
Return ONLY:
TOOL: <name>
ARGS: <json>
"""

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "minecraft_rpg_observe",
            "description": "Observe RPG/quest state",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "minecraft_observe",
            "description": "Observe player world state",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "minecraft_move_to",
            "description": "Walk to coordinates",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "z": {"type": "number"},
                },
                "required": ["x", "y", "z"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "minecraft_rpg_accept",
            "description": "Accept a quest if offered",
            "parameters": {
                "type": "object",
                "properties": {"questId": {"type": "string"}},
                "required": ["questId"],
            },
        },
    },
]

ALLOWED = {
    "minecraft_observe",
    "minecraft_move_to",
    "minecraft_rpg_observe",
    "minecraft_rpg_accept",
}


def post(path: str, body: dict, timeout: float = 180.0) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def get(path: str, timeout: float = 30.0) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def unload(model: str) -> None:
    try:
        post("/api/generate", {"model": model, "keep_alive": 0, "prompt": ""}, timeout=60)
    except Exception as exc:  # noqa: BLE001
        print(f"unload warn {model}: {exc}")


def score_text(text: str) -> dict:
    text_l = (text or "").strip()
    hallucinated = []
    for line in text_l.splitlines():
        if line.strip().upper().startswith("TOOL:"):
            name = line.split(":", 1)[1].strip().split()[0] if ":" in line else ""
            if name and name not in ALLOWED:
                hallucinated.append(name)
    has_tool = any(t in text_l for t in ALLOWED)
    prefers_observe = "minecraft_rpg_observe" in text_l or "minecraft_observe" in text_l
    premature_accept = "minecraft_rpg_accept" in text_l and not prefers_observe
    return {
        "nonempty": bool(text_l),
        "mentions_allowed_tool": has_tool,
        "prefers_observe_first": prefers_observe and "minecraft_rpg_accept" not in text_l.split("TOOL:")[0]
        if "TOOL:" in text_l
        else prefers_observe,
        "premature_accept": premature_accept,
        "hallucinated_tools": hallucinated,
        "preview": text_l[:400],
    }


def chat_simple(model: str, prompt: str, num_predict: int = 64) -> dict:
    t0 = time.perf_counter()
    try:
        out = post(
            "/api/chat",
            {
                "model": model,
                "stream": False,
                "keep_alive": "2m",
                "options": {
                    "num_ctx": 4096,
                    "num_predict": num_predict,
                    "temperature": 0.1,
                },
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=240,
        )
        dt = time.perf_counter() - t0
        msg = (out.get("message") or {}).get("content") or ""
        thinking = (out.get("message") or {}).get("thinking") or ""
        return {
            "ok": True,
            "latency_s": round(dt, 2),
            "eval_count": out.get("eval_count"),
            "prompt_eval_count": out.get("prompt_eval_count"),
            "eval_duration_ns": out.get("eval_duration"),
            "content": msg,
            "thinking_len": len(thinking),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "latency_s": round(time.perf_counter() - t0, 2),
            "content": "",
            "error": str(exc),
        }


def chat_tools(model: str, prompt: str) -> dict:
    t0 = time.perf_counter()
    try:
        out = post(
            "/v1/chat/completions",
            {
                "model": model,
                "temperature": 0.1,
                "max_tokens": 128,
                "tools": TOOLS_SCHEMA,
                "tool_choice": "auto",
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=240,
        )
        dt = time.perf_counter() - t0
        choice = (out.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        tool_calls = msg.get("tool_calls") or []
        names = []
        for tc in tool_calls:
            fn = (tc.get("function") or {})
            names.append(fn.get("name"))
        return {
            "ok": True,
            "latency_s": round(dt, 2),
            "tool_calls": names,
            "content": (msg.get("content") or "")[:300],
            "valid_tools_only": all(n in ALLOWED for n in names) if names else False,
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "latency_s": round(time.perf_counter() - t0, 2),
            "tool_calls": [],
            "error": str(exc),
        }


def main() -> int:
    out_dir = Path("/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner/reports")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_path = out_dir / f"model-probe-{stamp}.jsonl"

    tags = get("/api/tags")
    installed = {m["name"].split(":")[0] for m in tags.get("models", [])}
    installed |= {m["name"] for m in tags.get("models", [])}

    results = []
    with out_path.open("w", encoding="utf-8") as fh:
        for model in MODELS:
            # accept bare or :latest
            if model not in installed and f"{model}:latest" not in installed:
                row = {"model": model, "skipped": True, "reason": "not_installed"}
                results.append(row)
                fh.write(json.dumps(row) + "\n")
                fh.flush()
                print(json.dumps(row))
                continue

            print(f"=== probing {model} ===", flush=True)
            # unload others first to avoid VRAM thrash
            try:
                ps = get("/api/ps")
                for m in ps.get("models", []):
                    if m.get("name", "").split(":")[0] not in model:
                        unload(m.get("name"))
            except Exception as exc:  # noqa: BLE001
                print("ps/unload warn", exc)

            ping = chat_simple(model, "Reply with exactly PONG and nothing else.", num_predict=16)
            tool_text = chat_simple(model, TOOL_PROMPT, num_predict=96)
            recovery = chat_simple(model, RECOVERY_PROMPT, num_predict=96)
            tool_api = chat_tools(model, TOOL_PROMPT)

            row = {
                "model": model,
                "skipped": False,
                "ping": {k: ping[k] for k in ("ok", "latency_s", "content", "error", "eval_count", "thinking_len")},
                "tool_text": {
                    **{k: tool_text[k] for k in ("ok", "latency_s", "error", "eval_count", "thinking_len")},
                    "score": score_text(tool_text.get("content") or ""),
                },
                "recovery": {
                    **{k: recovery[k] for k in ("ok", "latency_s", "error", "eval_count", "thinking_len")},
                    "score": score_text(recovery.get("content") or ""),
                },
                "openai_tools": tool_api,
            }
            results.append(row)
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(json.dumps({k: row[k] for k in ("model", "ping", "openai_tools")}, indent=2)[:800], flush=True)
            unload(model)

    summary_path = out_dir / f"model-probe-{stamp}-summary.json"
    summary_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("WROTE", out_path)
    print("WROTE", summary_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
