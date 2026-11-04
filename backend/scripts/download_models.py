"""下载项目所需的模型文件到 backend/models/。

默认只下载本仓库新增的翻译模型（mt_zh_en）。
sentiment_bert 由维护者统一分发，默认不下载，避免拉到的版本与线上不一致。

用法:
    python backend/scripts/download_models.py                  # 只下翻译模型
    python backend/scripts/download_models.py mt_zh_en         # 同上（显式）
    python backend/scripts/download_models.py sentiment_bert   # 下情感模型（会覆盖已有）
    python backend/scripts/download_models.py --force          # 覆盖已存在的目录
"""
import sys
import logging
from pathlib import Path

import requests
from transformers import AutoTokenizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]           # backend/scripts → 项目根
MODELS_DIR = Path(__file__).resolve().parents[1] / "models"  # backend/scripts → backend/models


MODELS = {
    "mt_zh_en": {
        "repo": "Helsinki-NLP/opus-mt-zh-en",
        "task": "seq2seq",
    },
    # 保留原有能力：情感模型由维护者统一分发，
    # 默认不下载，避免与线上版本不一致
    "sentiment_bert": {
        "repo": "wxt5981/bert-base-uncased",
        "task": "seq_cls",
    },
}

# 不带参数时的默认目标：只下翻译模型
DEFAULT_TARGETS = ["mt_zh_en"]


def check_connection() -> bool:
    for url in ("https://huggingface.co/", "https://hf-mirror.com/"):
        try:
            requests.head(url, timeout=8)
            return True
        except requests.RequestException:
            continue
    logger.error("无法连接 HuggingFace（含镜像），请检查网络或设置 HF_ENDPOINT")
    return False


def load_pair(repo: str, task: str):
    if task == "seq2seq":
        from transformers import AutoModelForSeq2SeqLM as ModelCls
    else:
        from transformers import AutoModelForSequenceClassification as ModelCls
    return AutoTokenizer.from_pretrained(repo), ModelCls.from_pretrained(repo)


def download(name: str, force: bool = False) -> bool:
    spec = MODELS[name]
    dest = MODELS_DIR / name

    # 已有内容默认不覆盖，避免把本机调好的模型冲掉
    if dest.exists() and any(dest.iterdir()) and not force:
        logger.warning(f"[{name}] 目标目录已存在且非空，跳过：{dest}")
        logger.warning("         如需覆盖请加 --force")
        return True

    try:
        dest.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.error(f"无法创建目录 {dest}: {e}")
        return False

    logger.info(f"[{name}] 从 {spec['repo']} 下载...")
    try:
        tok, model = load_pair(spec["repo"], spec["task"])
    except Exception as e:
        logger.error(f"[{name}] 下载失败: {e}")
        return False

    tok.save_pretrained(dest)
    model.save_pretrained(dest)
    logger.info(f"[{name}] 已保存到 {dest}")
    return True


def main() -> int:
    force = "--force" in sys.argv

    # 先校验参数，参数错误时不必等网络探测
    targets = [a for a in sys.argv[1:] if not a.startswith("-")] or DEFAULT_TARGETS
    unknown = [t for t in targets if t not in MODELS]
    if unknown:
        logger.error(f"未知模型: {unknown}，可选: {list(MODELS)}")
        return 1

    if not check_connection():
        return 1

    failed = [n for n in targets if not download(n, force=force)]
    if failed:
        logger.error(f"以下模型下载失败: {failed}")
        return 1

    logger.info("全部完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
