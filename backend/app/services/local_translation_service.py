#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地中英翻译服务（Helsinki-NLP/opus-mt-zh-en，MarianMT，78M 参数）

设计要点：
- 懒加载：首次调用才加载模型，避免拖慢应用启动、也避免模型缺失时整个 app 崩掉
- 纯本地：不调用任何外部 LLM 接口
- 唯一兜底：模型不可用时返回原文（下游情感分析会退化为判中性，但系统不崩）
"""
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


class LocalTranslationService:
    """本地中英翻译，CPU 即可运行"""

    _instance: Optional["LocalTranslationService"] = None

    def __init__(self, model_dir: Optional[str] = None):
        import torch
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

        self._torch = torch

        if model_dir is None:
            # __file__ = /app/backend/app/services/local_translation_service.py
            backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            model_dir = os.path.join(backend_root, "models", "mt_zh_en")

        self.model_dir = os.path.abspath(model_dir)
        if not os.path.isdir(self.model_dir):
            raise FileNotFoundError(f"找不到本地翻译模型目录: {self.model_dir}")

        # 关键：78M 小模型 + 短句，线程数过多会让 OpenMP 同步开销远超实际计算量。
        # 容器内实测：14 线程 3.76s/句，4 线程 0.067s/句（快 56 倍）。
        cpu_cnt = os.cpu_count() or 1
        n_threads = max(1, min(4, cpu_cnt))
        torch.set_num_threads(n_threads)
        logger.info(f"[LocalTranslation] torch 线程数设为 {n_threads}（cpu_count={cpu_cnt}）")

        logger.info(f"[LocalTranslation] 正在加载 {self.model_dir}")
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_dir, local_files_only=True)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(self.model_dir, local_files_only=True)
        self.model.eval()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)
        logger.info(f"[LocalTranslation] 加载完成 ({self.device})")

    @classmethod
    def get(cls) -> "LocalTranslationService":
        """单例获取（懒加载）"""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def translate(self, text: str, max_length: int = 128) -> str:
        """
        Args:
            text: 中文原文
            max_length: 译文最大 token 数（翻译场景 128 足够，调大只会更慢）
        Returns:
            英文译文
        """
        if not text or not text.strip():
            return ""

        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            max_length=512,
            truncation=True,
        ).to(self.device)

        with self._torch.no_grad():
            # num_beams=1（贪心）比模型默认的 beam=6 快 3~5 倍，翻译质量差异可忽略
            # 注意：num_beams=1 时 early_stopping 无意义，传了会产生告警
            outputs = self.model.generate(
                **inputs,
                max_length=max_length,
                num_beams=1,
            )

        return self.tokenizer.decode(outputs[0], skip_special_tokens=True).strip()


def _has_chinese(text: str) -> bool:
    return any("\u4e00" <= c <= "\u9fff" for c in text or "")


def translate(text: str) -> str:
    """
    对外统一入口，签名与旧版 translation_llm_gateway.translate 保持一致，
    因此 dynamic_controller 只需替换 import 即可。

    失败策略：返回原文（绝不抛异常给调用方）
    """
    if not text or not text.strip():
        return text

    try:
        out = LocalTranslationService.get().translate(text)
    except Exception as e:
        logger.error(f"[translate] 本地翻译不可用，返回原文: {e}")
        return text

    if not out:
        return text

    # 译文仍含大量中文 -> 视为翻译失败
    zh_cnt = sum(1 for c in out if "\u4e00" <= c <= "\u9fff")
    if zh_cnt >= max(2, len(out) * 0.3):
        logger.warning(f"[translate] 译文仍为中文，返回原文: {out[:60]}")
        return text

    return out
