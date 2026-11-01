"""端到端测试：通过 HTTP 接口提交代码，验证判题结果与诊断结构。

    docker compose exec backend python tools/apitest.py
"""

from __future__ import annotations

import time

import httpx

BASE = "http://localhost:8000/api"

AC_CODE = """#include <stdio.h>
int main() {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a + b);
    return 0;
}
"""

CE_CODE = """#include <stdio.h>
int main() {
    int a, b;
    scanf("%d %d", &a, &b)
    printf("%d\\n", a + b);
    return 0;
}
"""

WA_CODE = """#include <stdio.h>
int main() {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a - b);
    return 0;
}
"""


def submit(code: str, problem_id: int = 1, language: str = "C") -> dict:
    r = httpx.post(f"{BASE}/submit",
                   json={"problem_id": problem_id, "language": language, "code": code},
                   timeout=30)
    r.raise_for_status()
    sid = r.json()["submission_id"]

    for _ in range(120):
        time.sleep(0.3)
        s = httpx.get(f"{BASE}/submissions/{sid}", timeout=30).json()
        if s["status"] != "Pending":
            return s
    return {"status": "TIMEOUT", "message": "轮询超时"}


def show(title: str, code: str) -> None:
    print("=" * 58)
    print(title)
    s = submit(code)
    print(f"  状态: {s['status']}    {s.get('message', '')}")
    detail = s.get("detail") or {}

    if detail.get("time_ms") or detail.get("memory_kb"):
        print(f"  耗时: {detail.get('time_ms')} ms   内存: "
              f"{round((detail.get('memory_kb') or 0) / 1024)} MB")

    for d in detail.get("diagnostics", []):
        loc = f"第 {d['line']} 行" + (f" 第 {d['col']} 列" if d["col"] else "")
        print(f"  [{loc}] {d['type_zh']}  ·  知识点：{d['knowledge']}")
        for line in d.get("snippet", [])[:3]:
            print(f"      {line}")
        print(f"      说明：{d['explain']}")
        for rel in d.get("related", []):
            print(f"      ↳ 关联第 {rel['line']} 行：{rel['message']}")

    for c in detail.get("cases", []):
        print(f"  测试点 {c['index']}: {c['status']}  {c['time_ms']}ms  {c['message']}")


if __name__ == "__main__":
    show("① 正确代码（期望 AC）", AC_CODE)
    show("② 漏分号（期望 CE，带中文诊断）", CE_CODE)
    show("③ 加减写反（期望 WA，指出差异位置）", WA_CODE)
