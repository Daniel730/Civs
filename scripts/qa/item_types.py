"""Parse Civs_servidor/item-types YAML definitions for QA selection and validation."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Optional

import yaml


@dataclass
class ItemType:
    key: str
    path: Path
    enabled: bool = True
    type: str = "region"
    name: str = ""
    groups: list[str] = field(default_factory=list)
    build_radius: Optional[int] = None
    instant_build: bool = False
    blueprint: Optional[str] = None
    is_in_shop: bool = True
    build_reqs: list[str] = field(default_factory=list)
    pre_reqs: list[str] = field(default_factory=list)
    towns: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def category(self) -> str:
        if self.groups:
            return self.groups[0]
        parts = self.path.parts
        for i, part in enumerate(parts):
            if part == "item-types" and i + 1 < len(parts):
                return parts[i + 1]
        return "unknown"

    @property
    def requires_town_membership(self) -> bool:
        return any(str(p).startswith("member=") for p in self.pre_reqs)

    @property
    def requires_inside_town(self) -> bool:
        """Civs cancels place if towns: is set and location is outside matching town."""
        return bool(self.towns) or self.requires_town_membership

    def validate_static(self, blueprints_dir: Optional[Path] = None) -> list[str]:
        issues: list[str] = []
        if not self.enabled:
            issues.append("disabled in YAML")
        if not self.name:
            issues.append("missing name")
        if self.type == "region" and self.build_radius is None and not self.instant_build:
            issues.append("region without build-radius or instant-build")
        if self.instant_build and blueprints_dir is not None:
            bp_name = self.blueprint or f"{self.key}.schem"
            bp_path = blueprints_dir / bp_name
            if not bp_path.exists():
                issues.append(f"instant-build but blueprint missing on disk: {bp_path.name} (may auto-generate at runtime)")
        return issues


def _file_key(root: Path, path: Path) -> str:
    rel = path.relative_to(root)
    return str(rel.with_suffix("")).replace("\\", "/")


def load_item_type(path: Path, root: Path) -> ItemType:
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    key = _file_key(root, path)
    stem = path.stem
    return ItemType(
        key=stem,
        path=path,
        enabled=bool(data.get("enabled", True)),
        type=str(data.get("type", "region")),
        name=str(data.get("name", stem)),
        groups=list(data.get("groups") or []),
        build_radius=data.get("build-radius"),
        instant_build=bool(data.get("instant-build", False)),
        blueprint=data.get("blueprint"),
        is_in_shop=bool(data.get("is-in-shop", True)),
        build_reqs=[str(x) for x in (data.get("build-reqs") or [])],
        pre_reqs=[str(x) for x in (data.get("pre-reqs") or [])],
        towns=[str(x) for x in (data.get("towns") or [])],
        raw=data,
    )


def iter_item_types(item_types_dir: Path) -> Iterator[ItemType]:
    root = item_types_dir.resolve()
    for path in sorted(root.rglob("*.yml")):
        if path.is_file():
            yield load_item_type(path, root)


def load_all(item_types_dir: Path) -> dict[str, ItemType]:
    return {it.key: it for it in iter_item_types(item_types_dir)}


def load_batch(item_types_dir: Path, names: list[str]) -> tuple[list[ItemType], list[str]]:
    all_types = load_all(item_types_dir)
    found: list[ItemType] = []
    missing: list[str] = []
    for name in names:
        if name in all_types:
            found.append(all_types[name])
        else:
            missing.append(name)
    return found, missing


def enabled_regions(item_types_dir: Path) -> list[ItemType]:
    return [
        it
        for it in iter_item_types(item_types_dir)
        if it.enabled and it.type == "region" and "invisible" not in it.path.parts
    ]
