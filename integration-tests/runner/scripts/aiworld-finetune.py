#!/usr/bin/env python3
"""
aiworld-finetune.py — turn rated AI World experiences into an Ollama fine-tune dataset.

Why: the NPC brain (lib/ai-world/ollama-brain.js) does LIVE INFERENCE only. To make the local
LLM actually LEARN from the Minecraft world (not just guess), we distill the closed
outcome/reward loop (Task A) into training examples:

    world-snapshot (user)  ->  focus the agent SHOULD have taken (assistant)

Sources: reports/aiworld-experiences/experiences-*.jsonl  (one JSON object per line).
Each line has: chosenIntent, observation {hostiles, nearest_hostile, deaths, ...},
stateRep.vec (17 floats), outcome {reward, died, damageTaken, goalFailed, ...}.

Quality filter (Task A closed the loop, so reward is trustworthy):
  - reward >= +1  -> POSITIVE example: assistant recommends the chosenIntent.
  - reward <= -2  -> NEGATIVE example: assistant explains what NOT to do and gives the
                     correct override (survive when a hostile was present, else maintain/build).

Output:
  reports/aiworld-finetune/dataset.jsonl   (Ollama chat fine-tune format)
  reports/aiworld-finetune/Modelfile       (points at the base model + dataset)
  reports/aiworld-finetune/manifest.json   (counts, base model, generatedAt)

This script only READS experiences and WRITES artifacts. It never trains — that is a separate
`ollama create` step the operator runs once the artifacts exist (see Modelfile header).

Usage:
  python scripts/aiworld-finetune.py [--src reports/aiworld-experiences] [--out reports/aiworld-finetune]
                                     [--base llama3.1:8b] [--max-per-agent 200] [--min-reward 1] [--max-neg -2]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

FOCUSES = ["survive", "found", "build", "maintain", "secure"]
SYSTEM_PROMPT = (
    "You are an autonomous Minecraft villager. Prioritize survival above all. "
    "Given the world snapshot, choose ONE focus from [survive, found, build, maintain, secure]. "
    "Respond ONLY with JSON: {\"focus\":\"...\",\"reason\":\"...\",\"target\":null}. "
    "If a host is near, prefer survive/flee. If settlement is built, maintain it."
)


def snap_from_obs(obs):
    """Mirror lib/ai-world/ollama-brain.js buildPrompt, but from a stored observation dict."""
    if not obs:
        return "WORLD SNAPSHOT: (empty)"
    nh = obs.get("nearest_hostile") or {}
    threats = []
    if obs.get("hostiles"):
        threats.append(str(obs.get("hostiles")))
    if nh.get("type"):
        threats.append("%s@%.1f" % (nh.get("type"), float(nh.get("distance", 0) or 0)))
    nearest_dist = -1
    try:
        nearest_dist = float(nh.get("distance", -1) or -1)
    except (TypeError, ValueError):
        nearest_dist = -1
    lines = [
        "WORLD SNAPSHOT:",
        "- health: %s" % (obs.get("health_pct", obs.get("health", "?"))),
        "- survivalState: %s" % (obs.get("survivalState", "SAFE")),
        "- position: (%s, %s)" % (obs.get("x", "?"), obs.get("z", "?")),
        "- threats: %s" % (", ".join(threats) if threats else "none"),
        "- nearestThreatDist: %s" % (nearest_dist if nearest_dist >= 0 else "unknown"),
        "- deaths: %s" % (obs.get("deaths", "?")),
        "- in_water: %s" % (obs.get("in_water", "?")),
        "- world_time: %s" % (obs.get("world_time", "?")),
        "- availableJobs: %s" % ", ".join(FOCUSES),
    ]
    return "\n".join(lines)


def correct_override(obs, chosen):
    """What the agent SHOULD have done in a negative example."""
    nh = obs.get("nearest_hostile") if isinstance(obs, dict) else None
    hostiles = (obs.get("hostiles", 0) if isinstance(obs, dict) else 0) or 0
    if nh or hostiles:
        return "survive", "a hostile was present; the agent should have fled/defended, not worked"
    # No hostile but still negative (e.g. wasted time) -> keep building/maintaining
    if chosen in ("build", "maintain", "found", "secure"):
        return chosen, "focus was acceptable; reward was low due to execution, not intent"
    return "maintain", "low reward with no threat; maintaining the settlement is the safe default"


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--src", default=os.path.join(here, "reports", "aiworld-experiences"))
    ap.add_argument("--out", default=os.path.join(here, "reports", "aiworld-finetune"))
    ap.add_argument("--base", default=os.environ.get("OLLAMA_MODEL", "hermes-agent-mc:latest"))
    ap.add_argument("--max-per-agent", type=int, default=200)
    ap.add_argument("--min-reward", type=float, default=1.0)
    ap.add_argument("--max-neg", type=float, default=-2.0)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    pos, neg = 0, 0
    per_agent = {}
    skipped = 0
    dataset_path = os.path.join(args.out, "dataset.jsonl")

    with open(dataset_path, "w", encoding="utf-8") as out:
        for fn in sorted(os.listdir(args.src)):
            if not fn.startswith("experiences-") or not fn.endswith(".jsonl"):
                continue
            agent = fn[len("experiences-"):-len(".jsonl")]
            per_agent[agent] = 0
            with open(os.path.join(args.src, fn), "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        o = json.loads(line)
                    except json.JSONDecodeError:
                        skipped += 1
                        continue
                    outcome = o.get("outcome")
                    if not isinstance(outcome, dict):
                        continue  # unrated decision snapshot
                    reward = outcome.get("reward")
                    if not isinstance(reward, (int, float)):
                        continue
                    chosen = o.get("chosenIntent") or (o.get("action") or {}).get("focus")
                    if chosen not in FOCUSES:
                        skipped += 1
                        continue
                    obs = o.get("observation") or {}
                    snap = snap_from_obs(obs)

                    if reward >= args.min_reward:
                        assistant = json.dumps({"focus": chosen, "reason": o.get("reason", "positive outcome"), "target": None})
                        rec = {"messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": snap},
                            {"role": "assistant", "content": assistant},
                        ]}
                        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                        pos += 1
                        per_agent[agent] += 1
                    elif reward <= args.max_neg:
                        if per_agent[agent] >= args.max_per_agent:
                            continue
                        good_focus, why = correct_override(obs, chosen)
                        assistant = json.dumps({
                            "focus": good_focus,
                            "reason": "NEGATIVE: chose '%s' (reward %.1f). %s" % (chosen, reward, why),
                            "target": None,
                        })
                        rec = {"messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": snap},
                            {"role": "assistant", "content": assistant},
                        ]}
                        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                        neg += 1
                        per_agent[agent] += 1
                    # mid-range rewards: omitted (not informative enough to train on)

    # Modelfile (Ollama fine-tune entrypoint). Operator runs:  ollama create civs-brain -f Modelfile
    modelfile = (
        "# Generated by aiworld-finetune.py — DO NOT EDIT BY HAND.\n"
        "FROM %s\n"
        "TEMPLATE \"\"\"{{ if .System }}<|im_start|>system\n{{ .System }}<|im_end|>\n{{ end }}"
        "{{ if .Prompt }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n{{ end }}"
        "<|im_start|>assistant\n{{ .Response }}<|im_end|>\n\"\"\"\n"
        "SYSTEM \"\"\"%s\"\"\"\n"
        "# Training data (chat format). Fine-tune with:  ollama create civs-brain -f Modelfile\n"
        "ADAPTER %s\n"
    ) % (args.base, SYSTEM_PROMPT, "dataset.jsonl")
    with open(os.path.join(args.out, "Modelfile"), "w", encoding="utf-8") as mf:
        mf.write(modelfile)

    # Prompt-only Modelfile: wraps the LOCAL base model with the NPC system prompt, NO adapter.
    # `ollama create civs-brain -f Modelfile.civs-brain` is instant (base already local) and gives
    # a consumable civs-brain today, without the ~4.9GB LoRA pull. Training (Modelfile with ADAPTER)
    # remains the path to a truly learned model when a stable base blob is available.
    modelfile_prompt_only = (
        "# Generated by aiworld-finetune.py — prompt-only civs-brain (no adapter, instant create).\n"
        "FROM %s\n"
        "SYSTEM \"\"\"%s\"\"\"\n"
        "# Usage:  ollama create civs-brain -f Modelfile.civs-brain\n"
        "# (LoRA training path: ollama create civs-brain -f Modelfile  — needs dataset.jsonl + base pull)\n"
    ) % (args.base, SYSTEM_PROMPT)
    with open(os.path.join(args.out, "Modelfile.civs-brain"), "w", encoding="utf-8") as mf2:
        mf2.write(modelfile_prompt_only)

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "baseModel": args.base,
        "positiveExamples": pos,
        "negativeExamples": neg,
        "totalExamples": pos + neg,
        "skippedUnratedOrBad": skipped,
        "perAgent": per_agent,
        "source": args.src,
        "dataset": dataset_path,
        "usage": "ollama create civs-brain -f Modelfile  (requires `ollama` CLI + dataset.jsonl)",
    }
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as mfw:
        json.dump(manifest, mfw, indent=2)

    print("OK dataset written: %s" % dataset_path)
    print("  positive: %d  negative: %d  total: %d  skipped: %d" % (pos, neg, pos + neg, skipped))
    print("  perAgent: %s" % json.dumps(per_agent))
    print("  Modelfile + manifest.json in %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
