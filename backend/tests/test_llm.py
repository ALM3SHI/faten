from services import llm


def test_gemini_tuning_raises_tiny_token_limits(settings):
    settings.AI_PROVIDER = "gemini"
    out = llm._tune_kwargs({"model": "m", "max_tokens": 20})
    assert out["max_tokens"] >= 2048 and out["reasoning_effort"] == settings.GEMINI_REASONING_EFFORT


def test_openai_requests_are_left_untouched(settings):
    settings.AI_PROVIDER = "openai"
    assert llm._tune_kwargs({"model": "m", "max_tokens": 20}) == {"model": "m", "max_tokens": 20}


def test_client_points_at_gemini_openai_endpoint(settings):
    settings.AI_PROVIDER = "gemini"
    c = llm.make_llm_client()
    assert str(c._client.base_url).startswith(llm.GEMINI_OPENAI_BASE_URL)


def test_tool_calls_keep_gemini_thought_signature():
    from openai.types.chat import ChatCompletionMessage
    m = ChatCompletionMessage.model_validate({
        "role": "assistant", "content": None,
        "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "f", "arguments": "{}"},
                        "extra_content": {"google": {"thought_signature": "SIG"}}}],
    })
    dumped = m.tool_calls[0].model_dump(exclude_none=True)
    assert dumped["extra_content"]["google"]["thought_signature"] == "SIG"
