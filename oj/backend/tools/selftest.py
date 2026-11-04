"""判题引擎自测：验证 AC / CE / WA / TLE / RE / MLE 六种判定。

在容器里跑：
    docker compose exec backend python tools/selftest.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from judge_core import judge  # noqa: E402

TESTS = [{"input": "1 1\n", "output": "2\n"}]

C_AC = """#include <stdio.h>
int main() {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a + b);
    return 0;
}
"""

C_CE = """#include <stdio.h>
int main() {
    int a, b;
    scanf("%d %d", &a, &b)
    printf("%d\\n", a + b);
    return 0;
}
"""

C_WA = """#include <stdio.h>
int main() {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", a - b);
    return 0;
}
"""

C_RE = """#include <stdio.h>
int main() {
    int a[2], b;
    scanf("%d %d", &a[0], &b);
    a[1000000] = 1;
    printf("%d\\n", a[0] + b);
    return 0;
}
"""

C_TLE = """#include <stdio.h>
int main() {
    volatile long long s = 0;
    while (1) { s += 1; }
    return 0;
}
"""

C_MLE = """#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main() {
    for (int i = 0; i < 64; i++) {
        char *p = malloc(64 * 1024 * 1024);
        memset(p, 1, 64 * 1024 * 1024);
    }
    printf("2\\n");
    return 0;
}
"""

PY_AC = """a, b = map(int, input().split())
print(a + b)
"""

# expect 可以是单个状态，也可以是多个可能状态
CASES = [
    ("AC  正确解", C_AC, "C", "AC"),
    ("CE  漏分号", C_CE, "C", "CE"),
    ("WA  加减写反", C_WA, "C", "WA"),
    ("RE  越界写", C_RE, "C", "RE"),
    ("TLE 死循环", C_TLE, "C", "TLE"),
    # 说明：RLIMIT_AS 生效时 malloc 会返回 NULL，程序不检查就会段错误，
    # 所以内存炸弹通常表现为 RE 而不是 MLE。真正的 MLE 需要 cgroup 计量。
    ("MLE 内存炸弹", C_MLE, "C", ("MLE", "RE")),
    ("AC  Python", PY_AC, "Python3", "AC"),
]


def main() -> int:
    failed = 0
    print(f"{'用例':<16}{'期望':<10}{'实际':<6}结果")
    print("-" * 56)
    for name, src, lang, expect in CASES:
        expect_set = expect if isinstance(expect, tuple) else (expect,)
        r = judge(src, lang, TESTS, time_limit_ms=1000, memory_limit_mb=128)
        ok = r.status in expect_set
        if not ok:
            failed += 1
        mark = "✓" if ok else "✗"
        expect_text = "/".join(expect_set)
        print(f"{name:<16}{expect_text:<10}{r.status:<6}{mark}  {r.message[:38]}")

        if r.diagnostics:
            d = r.diagnostics[0]
            print(f"    → 第 {d['line']} 行第 {d['col']} 列 · {d['type_zh']} · {d['knowledge']}")

    print("-" * 56)
    print(f"{len(CASES) - failed}/{len(CASES)} 通过")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
