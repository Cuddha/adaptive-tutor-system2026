# 模型文件说明

本目录用于存放项目运行所需的预训练模型及相关参数文件。

**除 `progress_clustering/` 外，其余模型文件均不纳入 Git 版本管理**，主要考虑到模型体积较大，超过 GitHub 单文件 100MB 的限制，需要用户根据实际需求自行获取。

模型缺失时，服务仍可正常启动，但对应功能将自动降级。

## 1. 模型目录结构

| 目录 | 用途 | 大小 | 获取方式 |
|---|---|---:|---|
| `progress_clustering/` | 进度聚类参数（中心、PCA、Scaler） | 2.4 MB | 已随仓库提交 |
| `sentiment_bert/` | 情感三分类模型 | 419 MB | 向项目维护者获取 |
| `mt_zh_en/` | 中英翻译模型（OPUS-MT） | 300 MB | 运行下载脚本 |
| `all-mpnet-base-v2/` | 聚类句向量编码器 | 420 MB | 手动下载 |

## 2. 模型获取方式

### 2.1 下载翻译模型（mt_zh_en）

项目提供了自动下载脚本，默认只下载翻译模型。

在项目根目录执行：

```bash
python backend/scripts/download_models.py
```

下载完成后，模型将自动保存至：

```text
backend/models/mt_zh_en/
```

脚本也支持显式指定模型：

```bash
python backend/scripts/download_models.py mt_zh_en
```

如需重新下载并更新已有模型文件，可以使用：

```bash
python backend/scripts/download_models.py --force
```

**说明：**
- 默认只下载 `Helsinki-NLP/opus-mt-zh-en`。
- 不会自动下载 `sentiment_bert` 和 `all-mpnet-base-v2`。
- 已存在且非空的模型目录默认跳过，不会覆盖本地文件。
- 下载过程需要能够访问 Hugging Face；如需使用镜像，可配置 `HF_ENDPOINT`。

如果自动下载脚本无法使用，也可以手动下载模型。模型目录中只需保留以下文件：

```text
config.json
pytorch_model.bin        # 或 model.safetensors
source.spm
target.spm
vocab.json
tokenizer_config.json
generation_config.json
```

以下文件不需要下载：

| 文件 | 大小 | 说明 |
|---|---:|---|
| `tf_model.h5` | 299 MB | TensorFlow 格式权重 |
| `rust_model.ot` | 552 MB | Rust / Candle 格式权重 |
| `.git/` | 1.2 GB | 仓库 Git 历史数据 |

### 2.2 获取情感模型（sentiment_bert）

情感分类模型由项目维护者统一提供，以保证模型版本与项目运行环境一致。

请向项目维护者获取模型文件，并将其放置于：

```text
backend/models/sentiment_bert/
```

不建议自行从 Hugging Face 下载其他版本替代，以免出现模型结构、权重或分类标签不匹配的问题。

### 2.3 获取聚类编码器（all-mpnet-base-v2）

聚类功能依赖 `all-mpnet-base-v2` 句向量编码器。

请从 Hugging Face 下载对应模型，并将完整模型文件放置于：

```text
backend/models/all-mpnet-base-v2/
```

确保目录中包含模型配置、权重及 Tokenizer 所需文件。

## 3. 模型缺失时的降级行为

为保证服务在模型文件不完整或缺失时仍能正常启动，项目对部分模型提供了降级处理。

| 缺失模型 | 功能表现 | 降级方式 |
|---|---|---|
| `mt_zh_en/` | 翻译功能返回原文 | 不执行翻译，日志提示 `[LocalTranslation] 找不到模型目录` |
| `sentiment_bert/` | 情感分类恒为 `NEUTRAL` | 使用默认中性结果，置信度为 `1.0` |
| `all-mpnet-base-v2/` | 进度聚类仍可运行 | 根据消息长度进行启发式推测，`classification_type=fallback` |

**注意：** 降级模式仅用于保证服务可用，不代表对应功能仍能提供正常的模型推理效果。需要完整功能时，请按照上述说明补齐模型文件。

## 4. 目录结构示例

完成模型配置后，`backend/models/` 目录结构如下：

```text
backend/
└── models/
    ├── progress_clustering/
    │   └── ...                     # 已随仓库提交
    ├── sentiment_bert/
    │   └── ...                     # 维护者提供
    ├── mt_zh_en/
    │   └── ...                     # 脚本下载
    └── all-mpnet-base-v2/
        └── ...                     # 手动下载
```

其中，只有 `progress_clustering/` 纳入 Git 版本管理，其余目录中的模型文件需要自行配置。