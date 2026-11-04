# backend/app/services/llm_gateway.py
import os
import asyncio
from typing import List, Dict, Any, Optional
from openai import OpenAI
from app.core.config import settings


class TranslationLLMGateway:
    """LLM网关服务"""
    
    def __init__(self):
        # 配置优先级：TUTOR_TRANSLATION_* > TUTOR_OPENAI_* > 空
        # 之前这里是硬编码的模型与 key，导致 .env 里的配置完全不生效
        self.api_key = (
            settings.TUTOR_TRANSLATION_API_KEY
            or settings.TUTOR_OPENAI_API_KEY
            or ""
        )
        self.api_base = (
            settings.TUTOR_TRANSLATION_API_BASE
            or settings.TUTOR_OPENAI_API_BASE
            or ""
        )
        self.model = (
            settings.TUTOR_TRANSLATION_MODEL
            or settings.TUTOR_OPENAI_MODEL
            or ""
        )

        self.max_tokens = 1024
        # 翻译需要确定性，温度用 0（原来 0.7 会让同一句话两次译出不同结果）
        self.temperature = 0.0
        # 翻译是同步阻塞调用，必须设超时，否则上游排队会把 worker 卡住
        self.timeout = 20.0

        # 初始化OpenAI客户端（兼容魔搭 / DeepSeek 等 OpenAI 兼容接口）
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.api_base,
            timeout=self.timeout,
            max_retries=1,
        )
        # 最近一次调用的token用量
        self.last_usage: Optional[dict] = None
    
    def get_completion_sync(
        self, 
        system_prompt: str, 
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None
    ) -> str:
        """
        同步获取LLM完成结果
        
        Args:
            system_prompt: 系统提示词
            messages: 消息列表
            max_tokens: 最大token数
            temperature: 温度参数
            
        Returns:
            str: LLM生成的回复
        """
        try:
            # 构建完整的消息列表
            full_messages = [{"role": "system", "content": system_prompt}] + messages
            
            # 使用传入的参数或默认值
            max_tokens = self.max_tokens if max_tokens is None else max_tokens
            temperature = self.temperature if temperature is None else temperature
            
            # 直接调用OpenAI客户端（同步）
            response = self.client.chat.completions.create(
                model=self.model,
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=temperature
            )
            
            # 提取回复内容
            # 记录usage（若提供）
            try:
                usage = getattr(response, 'usage', None)
                if usage is not None:
                    self.last_usage = {
                        'prompt_tokens': getattr(usage, 'prompt_tokens', None),
                        'completion_tokens': getattr(usage, 'completion_tokens', None),
                        'total_tokens': getattr(usage, 'total_tokens', None),
                    }
                else:
                    self.last_usage = None
            except Exception:
                self.last_usage = None

            if response.choices and len(response.choices) > 0:
                return response.choices[0].message.content
            else:
                return "I apologize, but I couldn't generate a response at this time."
                
        except Exception as e:
            print(f"Error calling LLM API: {e}")
            return f"I apologize, but I encountered an error: {str(e)}"
    
    async def get_completion(
        self, 
        system_prompt: str, 
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None
    ) -> str:
        """
        获取LLM完成结果
        
        Args:
            system_prompt: 系统提示词
            messages: 消息列表
            max_tokens: 最大token数
            temperature: 温度参数
            
        Returns:
            str: LLM生成的回复
        """
        try:
           
            # 构建完整的消息列表
            full_messages = [{"role": "system", "content": system_prompt}] + messages
            
            # 使用传入的参数或默认值
            max_tokens = self.max_tokens if max_tokens is None else max_tokens
            temperature = self.temperature if temperature is None else temperature
            
            # 调用LLM API - OpenAI客户端是同步的
            # 使用 asyncio.to_thread 来在异步环境中运行同步代码

           
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=self.model,
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=temperature
                
            )
            
          

            # 记录usage（若提供）
            try:
                usage = getattr(response, 'usage', None)
                if usage is not None:
                    self.last_usage = {
                        'prompt_tokens': getattr(usage, 'prompt_tokens', None),
                        'completion_tokens': getattr(usage, 'completion_tokens', None),
                        'total_tokens': getattr(usage, 'total_tokens', None),
                    }
                else:
                    self.last_usage = None
            except Exception:
                self.last_usage = None

            if response.choices and len(response.choices) > 0:
                return response.choices[0].message.content
            else:
                return "I apologize, but I couldn't generate a response at this time."
                
        except Exception as e:
            print(f"Error calling LLM API: {e}")
            return f"I apologize, but I encountered an error: {str(e)}"
    
    
    async def get_stream_completion(
        self, 
        system_prompt: str, 
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None
    ):
        """
        获取LLM流式完成结果
        
        Args:
            system_prompt: 系统提示词
            messages: 消息列表
            max_tokens: 最大token数
            temperature: 温度参数
            
        Yields:
            str: LLM生成的回复片段
        """
        try:
            # 构建完整的消息列表
            full_messages = [{"role": "system", "content": system_prompt}] + messages
            
            # 使用传入的参数或默认值
            max_tokens = self.max_tokens if max_tokens is None else max_tokens
            temperature = self.temperature if temperature is None else temperature
            
            # 调用LLM API - OpenAI客户端是同步的
            # 使用 asyncio.to_thread 来在异步环境中运行同步代码
            
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=self.model,
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
            )
            
            # 流式返回内容
            for chunk in response:
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        yield delta.content
            
            '''
            # 直接异步流式
            async with self.client.chat.completions.stream(
                model=self.model,
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=temperature,
            ) as stream:
                async for event in stream:
                    if event.type == "message.delta" and event.delta.get("content"):
                        yield event.delta["content"]
            '''
        except Exception as e:
            print(f"Error calling LLM API: {e}")
            yield f"I apologize, but I encountered an error: {str(e)}"
       
    

# 创建单例实例
translation_llm_gateway = TranslationLLMGateway()
def translate(text: str) -> str:
            import logging
            logger = logging.getLogger(__name__)
            # 尝试翻译用户消息为英文
            try:
               
               
                messages = [{"role": "user", "content": text}]
                translated_message = translation_llm_gateway.get_completion_sync(
                    system_prompt="Translate into English without adding other components, while keeping the emotions of the original text and the translation consistent.",
                    messages=messages
                )
                # 检测翻译是否失败（模型不可用或接口异常时返回的是英文错误提示文本）
                if not translated_message or not translated_message.strip():
                    return text
                if translated_message.startswith("I apologize") or "Error code" in translated_message or "has no provider supported" in translated_message:
                    logger.warning(f"翻译服务异常，使用原文: {translated_message[:80]}")
                    return text

                # 译文仍是中文（或与原文完全一致）说明这一跳没起作用，
                # 记一条告警便于定位，避免"静默不翻译"难以发现
                zh_cnt = sum(1 for c in translated_message if "\u4e00" <= c <= "\u9fff")
                if zh_cnt >= max(2, len(translated_message) * 0.3):
                    logger.warning(
                        f"翻译结果仍为中文，将使用原文（下游情感模型为英文词表）: "
                        f"{translated_message[:60]}"
                    )
                    return text
                
            except Exception as e:
                logger.info(f"⚠️ 翻译失败: {e}")
                translated_message = text
            return translated_message
