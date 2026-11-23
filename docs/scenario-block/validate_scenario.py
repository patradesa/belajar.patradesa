#!/usr/bin/env python3
"""Validator acuan Blok Skenario PatraDesa Belajar v1.0.

Hanya pustaka standar Python (tanpa dependensi). Dua lapis pemeriksaan:
  1. Struktur: menafsirkan subset JSON Schema 2020-12 dari scenario-block.schema.json
     (type, required, properties, additionalProperties:false, const, enum, pattern,
     minLength/maxLength, minimum/maximum, minItems/maxItems, uniqueItems, items,
     oneOf, $ref, format:date).
  2. Aturan alur (tidak bisa diungkapkan di JSON Schema):
     F1 id node unik; id opsi unik per node
     F2 startNodeId dan setiap nextNodeId merujuk node yang ada
     F3 tidak ada siklus
     F4 tidak ada node yatim (semua node terjangkau dari startNodeId)
     F5 minimal satu node 'end' terjangkau
     F6 node keputusan: >=1 opsi 'best'; setiap 'best' memegang skor tertinggi node;
        opsi non-best skornya lebih rendah dari skor tertinggi
     F7 scoring.bands: ada band minPercent 0, key dan minPercent unik
     F8 status 'published' wajib review.reviewedBy, reviewedAt, nextReviewDue
        (nextReviewDue > reviewedAt)
     F9 mode 'graded' wajib maxScore > 0
  maxScore = jumlah skor tertinggi di sepanjang jalur bernilai terbesar dari start ke end.

Pemakaian:
  python validate_scenario.py FILE.json [--schema PATH] [--json]
Kode keluar: 0 = valid, 1 = tidak valid, 2 = galat pemakaian/berkas.

Logika aturan alur dan perhitungan maxScore WAJIB diporting ke backend
dengan hasil yang sama (lihat README §6).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DEFAULT_SCHEMA = HERE / "scenario-block.schema.json"


# ---------------------------------------------------------------- struktur ---

class SchemaChecker:
    def __init__(self, schema: dict[str, Any]):
        self.root = schema

    def _resolve(self, ref: str) -> dict[str, Any]:
        if not ref.startswith("#/"):
            raise ValueError(f"$ref tidak didukung: {ref}")
        node: Any = self.root
        for part in ref[2:].split("/"):
            node = node[part]
        return node

    @staticmethod
    def _type_ok(value: Any, t: str) -> bool:
        if t == "object":
            return isinstance(value, dict)
        if t == "array":
            return isinstance(value, list)
        if t == "string":
            return isinstance(value, str)
        if t == "integer":
            return isinstance(value, int) and not isinstance(value, bool)
        if t == "number":
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        if t == "boolean":
            return isinstance(value, bool)
        if t == "null":
            return value is None
        return False

    def check(self, value: Any, schema: dict[str, Any], path: str = "") -> list[str]:
        errs: list[str] = []
        loc = path or "/"
        if "$ref" in schema:
            return self.check(value, self._resolve(schema["$ref"]), path)

        if "oneOf" in schema:
            branches = schema["oneOf"]
            results = [self.check(value, b, path) for b in branches]
            ok = [r for r in results if not r]
            if len(ok) == 1:
                return errs
            if len(ok) > 1:
                return [f"{loc}: cocok dengan lebih dari satu bentuk (oneOf)"]
            # Pilih cabang yang 'type'-nya cocok agar pesan galat berguna.
            if isinstance(value, dict) and "type" in value:
                for b, r in zip(branches, results):
                    rb = self._resolve(b["$ref"]) if "$ref" in b else b
                    const = rb.get("properties", {}).get("type", {}).get("const")
                    if const == value["type"]:
                        return r
                return [f"{loc}/type: nilai '{value['type']}' tidak dikenal"]
            return [f"{loc}: tidak cocok dengan bentuk mana pun (oneOf)"]

        if "const" in schema and value != schema["const"]:
            errs.append(f"{loc}: harus bernilai {json.dumps(schema['const'])}")
        if "enum" in schema and value not in schema["enum"]:
            errs.append(f"{loc}: nilai {json.dumps(value, ensure_ascii=False)} tidak termasuk {schema['enum']}")
        if "type" in schema and not self._type_ok(value, schema["type"]):
            errs.append(f"{loc}: harus bertipe {schema['type']}")
            return errs

        if isinstance(value, str):
            if "minLength" in schema and len(value) < schema["minLength"]:
                errs.append(f"{loc}: terlalu pendek (min {schema['minLength']} karakter)")
            if "maxLength" in schema and len(value) > schema["maxLength"]:
                errs.append(f"{loc}: terlalu panjang (maks {schema['maxLength']} karakter)")
            if "pattern" in schema and not re.search(schema["pattern"], value):
                errs.append(f"{loc}: format tidak sesuai pola {schema['pattern']}")
            if schema.get("format") == "date":
                try:
                    _dt.date.fromisoformat(value)
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                        raise ValueError
                except ValueError:
                    errs.append(f"{loc}: harus tanggal YYYY-MM-DD")

        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if "minimum" in schema and value < schema["minimum"]:
                errs.append(f"{loc}: minimal {schema['minimum']}")
            if "maximum" in schema and value > schema["maximum"]:
                errs.append(f"{loc}: maksimal {schema['maximum']}")

        if isinstance(value, list):
            if "minItems" in schema and len(value) < schema["minItems"]:
                errs.append(f"{loc}: minimal {schema['minItems']} butir")
            if "maxItems" in schema and len(value) > schema["maxItems"]:
                errs.append(f"{loc}: maksimal {schema['maxItems']} butir")
            if schema.get("uniqueItems"):
                seen = [json.dumps(v, sort_keys=True) for v in value]
                if len(seen) != len(set(seen)):
                    errs.append(f"{loc}: butir tidak boleh berulang")
            if "items" in schema:
                for i, item in enumerate(value):
                    errs += self.check(item, schema["items"], f"{path}/{i}")

        if isinstance(value, dict):
            props = schema.get("properties", {})
            for key in schema.get("required", []):
                if key not in value:
                    errs.append(f"{loc}: wajib ada field '{key}'")
            if schema.get("additionalProperties") is False:
                for key in value:
                    if key not in props:
                        errs.append(f"{path}/{key}: field tidak dikenal")
            for key, sub in props.items():
                if key in value:
                    errs += self.check(value[key], sub, f"{path}/{key}")
        return errs


# ------------------------------------------------------------- aturan alur ---

def node_index(doc: dict[str, Any]) -> dict[str, tuple[int, dict[str, Any]]]:
    return {n["id"]: (i, n) for i, n in enumerate(doc["nodes"])}


def edges_of(node: dict[str, Any]) -> list[str]:
    if node["type"] == "info":
        return [node["nextNodeId"]]
    if node["type"] == "decision":
        out: list[str] = []
        for opt in node["options"]:
            if opt["nextNodeId"] not in out:
                out.append(opt["nextNodeId"])
        return out
    return []


def compute_max_score(doc: dict[str, Any]) -> int:
    """Nilai jalur terbesar dari startNodeId ke node 'end'.

    Prasyarat: alur valid (tanpa siklus, rujukan valid). Untuk node keputusan,
    hanya opsi bernilai tertinggi yang dihitung per langkah, tetapi semua cabang
    ditelusuri karena opsi berbeda bisa menuju jalur dengan jumlah keputusan berbeda.
    """
    idx = node_index(doc)
    memo: dict[str, int] = {}

    def best_from(nid: str) -> int:
        if nid in memo:
            return memo[nid]
        node = idx[nid][1]
        if node["type"] == "end":
            val = 0
        elif node["type"] == "info":
            val = best_from(node["nextNodeId"])
        else:
            val = max(opt["score"] + best_from(opt["nextNodeId"]) for opt in node["options"])
        memo[nid] = val
        return val

    return best_from(doc["startNodeId"])


def check_flow(doc: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    nodes = doc["nodes"]

    # F1
    ids: dict[str, int] = {}
    for i, n in enumerate(nodes):
        if n["id"] in ids:
            errs.append(f"/nodes/{i}/id: id '{n['id']}' sudah dipakai node /nodes/{ids[n['id']]}")
        else:
            ids[n["id"]] = i
        if n["type"] == "decision":
            seen: set[str] = set()
            for j, opt in enumerate(n["options"]):
                if opt["id"] in seen:
                    errs.append(f"/nodes/{i}/options/{j}/id: id opsi '{opt['id']}' berulang di node '{n['id']}'")
                seen.add(opt["id"])
    if errs:
        return errs  # rujukan tidak bisa dicek dengan andal bila id berulang

    # F2
    if doc["startNodeId"] not in ids:
        errs.append(f"/startNodeId: node '{doc['startNodeId']}' tidak ada")
    for i, n in enumerate(nodes):
        if n["type"] == "info" and n["nextNodeId"] not in ids:
            errs.append(f"/nodes/{i}/nextNodeId: node '{n['nextNodeId']}' tidak ada")
        if n["type"] == "decision":
            for j, opt in enumerate(n["options"]):
                if opt["nextNodeId"] not in ids:
                    errs.append(f"/nodes/{i}/options/{j}/nextNodeId: node '{opt['nextNodeId']}' tidak ada")
                if opt["nextNodeId"] == n["id"]:
                    errs.append(f"/nodes/{i}/options/{j}/nextNodeId: opsi menunjuk node itu sendiri")
    if errs:
        return errs

    idx = node_index(doc)

    # F3 siklus (DFS tiga warna, dari semua node)
    WHITE, GREY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in ids}
    cycle_errs: list[str] = []

    def dfs(nid: str, trail: list[str]) -> None:
        color[nid] = GREY
        for nxt in edges_of(idx[nid][1]):
            if color[nxt] == GREY:
                loop = trail[trail.index(nxt):] + [nid, nxt] if nxt in trail else [nid, nxt]
                cycle_errs.append(f"/nodes/{idx[nid][0]}: siklus terdeteksi ({' -> '.join(dict.fromkeys(loop))} -> {nxt})")
            elif color[nxt] == WHITE:
                dfs(nxt, trail + [nid])
        color[nid] = BLACK

    for nid in ids:
        if color[nid] == WHITE:
            dfs(nid, [])
    if cycle_errs:
        return errs + cycle_errs

    # F4 node yatim
    reach: set[str] = set()
    stack = [doc["startNodeId"]]
    while stack:
        cur = stack.pop()
        if cur in reach:
            continue
        reach.add(cur)
        stack.extend(edges_of(idx[cur][1]))
    for i, n in enumerate(nodes):
        if n["id"] not in reach:
            errs.append(f"/nodes/{i}: node '{n['id']}' yatim (tidak terjangkau dari startNodeId)")

    # F5
    if not any(idx[nid][1]["type"] == "end" for nid in reach):
        errs.append("/nodes: tidak ada node 'end' yang terjangkau")

    # F6
    for i, n in enumerate(nodes):
        if n["type"] != "decision":
            continue
        opts = n["options"]
        top = max(o["score"] for o in opts)
        bests = [j for j, o in enumerate(opts) if o["verdict"] == "best"]
        if not bests:
            errs.append(f"/nodes/{i}/options: node '{n['id']}' tidak punya opsi 'best'")
            continue
        for j in bests:
            if opts[j]["score"] != top:
                errs.append(f"/nodes/{i}/options/{j}/score: opsi 'best' harus memegang skor tertinggi node ({top})")
        for j, o in enumerate(opts):
            if o["verdict"] != "best" and o["score"] >= top:
                errs.append(f"/nodes/{i}/options/{j}/score: opsi '{o['verdict']}' tidak boleh menyamai/melebihi skor opsi 'best'")

    # F7
    bands = doc["scoring"]["bands"]
    mins = [b["minPercent"] for b in bands]
    keys = [b["key"] for b in bands]
    if 0 not in mins:
        errs.append("/scoring/bands: wajib ada band dengan minPercent 0")
    if len(set(mins)) != len(mins):
        errs.append("/scoring/bands: minPercent tidak boleh berulang")
    if len(set(keys)) != len(keys):
        errs.append("/scoring/bands: key tidak boleh berulang")

    # F8
    if doc["status"] == "published":
        review = doc.get("review") or {}
        for field in ("reviewedBy", "reviewedAt", "nextReviewDue"):
            if not review.get(field):
                errs.append(f"/review/{field}: wajib diisi untuk status 'published'")
        if review.get("reviewedAt") and review.get("nextReviewDue"):
            try:
                if _dt.date.fromisoformat(review["nextReviewDue"]) <= _dt.date.fromisoformat(review["reviewedAt"]):
                    errs.append("/review/nextReviewDue: harus setelah reviewedAt")
            except ValueError:
                pass  # format sudah dilaporkan lapis struktur

    # F9
    if not errs and doc["mode"] == "graded" and compute_max_score(doc) <= 0:
        errs.append("/mode: blok 'graded' wajib punya maxScore > 0")
    return errs


# -------------------------------------------------------------------- utama ---

def validate(doc: Any, schema: dict[str, Any]) -> tuple[list[str], int | None]:
    errs = SchemaChecker(schema).check(doc, schema)
    if errs:
        return errs, None
    errs = check_flow(doc)
    if errs:
        return errs, None
    return [], compute_max_score(doc)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validasi berkas Blok Skenario PatraDesa v1.0")
    ap.add_argument("file", type=Path)
    ap.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    ap.add_argument("--json", action="store_true", help="keluaran JSON (untuk CI/editor)")
    args = ap.parse_args(argv)

    try:
        schema = json.loads(args.schema.read_text(encoding="utf-8"))
        doc = json.loads(args.file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"GALAT: tidak bisa membaca berkas: {exc}", file=sys.stderr)
        return 2

    errs, max_score = validate(doc, schema)
    if args.json:
        print(json.dumps({"valid": not errs, "maxScore": max_score, "errors": errs}, ensure_ascii=False, indent=2))
    elif errs:
        print(f"TIDAK VALID: {args.file.name} ({len(errs)} masalah)")
        for e in errs:
            print(f"  - {e}")
    else:
        print(f"VALID: {args.file.name} | id={doc['id']} v{doc['version']} | status={doc['status']} | mode={doc['mode']} | maxScore={max_score}")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
