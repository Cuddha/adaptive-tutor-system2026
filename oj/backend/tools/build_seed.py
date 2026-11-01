"""把选好的题目 CSV 转成项目内的种子文件 data/problems.json。

只在构建时跑一次，生成后项目自包含，运行时不依赖外部 CSV。

用法：
    python tools/build_seed.py
    python tools/build_seed.py --csv "D:/path/to/selected_38_problems_raw.csv"
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys

DEFAULT_CSV = r"D:/demo/d3.1/8.25/调研结果/01_BePKT_PDKT/数据/selected_38_problems_raw.csv"
OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "problems.json")

# (题号, 模块, 知识点, 难度, 排序)
CHAPTERS = [
    (1,   "A", "输入输出与复杂度", "易",   1),
    (188, "A", "输入输出与复杂度", "易",   2),
    (211, "B", "枚举与模拟",      "易",   3),
    (16,  "B", "枚举与模拟",      "易",   4),
    (216, "B", "递推与递归入门",   "易",   5),
    (215, "B", "递推与递归入门",   "易",   6),
    (124, "B", "递推与递归入门",   "易",   7),
    (270, "B", "排序",           "中",   8),
    (579, "B", "排序",           "中",   9),
    (580, "B", "排序",           "中",  10),
    (577, "B", "二分与双指针",     "中",  11),
    (180, "B", "二分与双指针",     "中",  12),
    (212, "C", "数论基础",        "易",  13),
    (11,  "C", "数论基础",        "中",  14),
    (12,  "C", "数论基础",        "中",  15),
    (153, "C", "字符串处理",      "易",  16),
    (514, "C", "字符串处理",      "中",  17),
    (27,  "C", "字符串处理",      "易",  18),
    (571, "D", "队列",           "中",  19),
    (572, "D", "队列",           "中",  20),
    (573, "D", "链表",           "中",  21),
    (586, "D", "链表",           "中",  22),
    (282, "D", "哈希与查找",      "中",  23),
    (422, "D", "哈希与查找",      "较难", 24),
    (2,   "E", "回溯与剪枝",      "较难", 25),
    (19,  "E", "回溯与剪枝",      "较难", 26),
    (411, "E", "DFS 与 BFS",     "较难", 27),
    (412, "E", "DFS 与 BFS",     "较难", 28),
    (88,  "E", "DFS 与 BFS",     "较难", 29),
    (590, "F", "二叉树",          "较难", 30),
    (441, "F", "二叉树",          "较难", 31),
    (443, "F", "图基础",          "较难", 32),
    (449, "F", "图基础",          "较难", 33),
    (593, "F", "最小生成树",      "难",  34),
    (440, "F", "最小生成树",      "难",  35),
    (187, "G", "线性 DP",        "中",  36),
    (54,  "G", "线性 DP",        "难",  37),
    (37,  "G", "线性 DP",        "难",  38),
]


def parse_samples(raw: str) -> tuple[list[dict], list[dict]]:
    """samples 字段是 [{"input":..., "output":...}]，同时作为测试点。"""
    try:
        items = json.loads(raw) if raw and raw.strip() else []
    except json.JSONDecodeError:
        return [], []

    samples, tests = [], []
    for it in items:
        inp = (it.get("input") or "").rstrip()
        out = (it.get("output") or "").rstrip()
        if not inp.strip() or not out.strip():
            continue
        samples.append({"input": inp, "output": out})
        # 测试点保留原始换行，比对时由判题器归一化
        tests.append({"input": inp + "\n", "output": out + "\n"})
    return samples, tests


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=DEFAULT_CSV)
    args = ap.parse_args()

    if not os.path.exists(args.csv):
        print(f"找不到 CSV：{args.csv}", file=sys.stderr)
        return 1

    with open(args.csv, encoding="utf-8", newline="") as f:
        rows = {int(r["id"]): r for r in csv.DictReader(f)}

    problems, missing = [], []
    for pid, module, kp, diff, order in CHAPTERS:
        r = rows.get(pid)
        if r is None:
            missing.append(pid)
            continue
        samples, tests = parse_samples(r.get("samples", ""))
        problems.append({
            "id": pid,
            "title": r["title"].strip(),
            "description": r.get("description", ""),
            "input_description": r.get("input_description", ""),
            "output_description": r.get("output_description", ""),
            "samples": samples,
            "tests": tests,
            "difficulty": diff,
            "time_limit": int(float(r.get("time_limit") or 1000)),
            "memory_limit": int(float(r.get("memory_limit") or 256)),
            "source": f"{module} · {kp}",
            "module": module,
            "knowledge": kp,
            "sort_order": order,
        })

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(problems, f, ensure_ascii=False, indent=1)

    total_tests = sum(len(p["tests"]) for p in problems)
    print(f"写出 {len(problems)} 道题 -> {OUT_PATH}")
    print(f"测试点合计 {total_tests} 个")
    no_test = [p["id"] for p in problems if not p["tests"]]
    if no_test:
        print(f"⚠ 没有测试点的题：{no_test}")
    if missing:
        print(f"⚠ CSV 里缺失的题号：{missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
