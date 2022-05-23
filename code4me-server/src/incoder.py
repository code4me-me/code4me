import os
from typing import List

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_name = "facebook/incoder-1B"
kwargs = {}
CUDA = os.getenv("CODE4ME_CUDA", "False") == "True"

print("loading model")
model = AutoModelForCausalLM.from_pretrained(model_name, **kwargs)
print("loading tokenizer")
tokenizer = AutoTokenizer.from_pretrained(model_name)
print("loading complete")

if CUDA:
    # if you plan to fine-tune the model, you should not use half precision.
    model = model.half().cuda()

# signals the start of a document
BOS = "<|endoftext|>"
# signals the end of a generated infill
EOM = "<|endofmask|>"


def make_sentinel(i):
    # signals (1) a location to insert an infill and (2) the start of the infill generation
    return f"<|mask:{i}|>"


def generate(input: str, max_to_generate: int = 128, temperature: float = 0.2):
    input_ids = tokenizer(input, return_tensors="pt").input_ids
    if CUDA:
        input_ids = input_ids.cuda()
    max_length = max_to_generate + input_ids.flatten().size(0)
    if max_length > 2048:
        print("warning: max_length {} is greater than the context window {}".format(max_length, 2048))
    with torch.no_grad():
        output = model.generate(input_ids=input_ids, do_sample=True, top_p=0.95, temperature=temperature,
                                max_length=max_length)
    detok_hypo_str = tokenizer.decode(output.flatten())
    if detok_hypo_str.startswith(BOS):
        detok_hypo_str = detok_hypo_str[len(BOS):]
    return detok_hypo_str


def infill(parts: List[str], max_to_generate: int = 128, temperature: float = 0.2, extra_sentinel: bool = True):

    assert isinstance(parts, list)

    ## (1) build the prompt
    if len(parts) == 1:
        prompt = parts[0]
    else:
        prompt = ""
        # encode parts separated by sentinel
        for sentinel_ix, part in enumerate(parts):
            prompt += part
            if extra_sentinel or (sentinel_ix < len(parts) - 1):
                prompt += make_sentinel(sentinel_ix)

    infills = []
    complete = []

    ## (2) generate infills
    for sentinel_ix, part in enumerate(parts[:-1]):
        complete.append(part)
        prompt += make_sentinel(sentinel_ix)
        completion = generate(prompt, max_to_generate, temperature)
        completion = completion[len(prompt):]
        if EOM not in completion:
            completion += EOM
        completion = completion[:completion.index(EOM) + len(EOM)]
        infilled = completion[:-len(EOM)]
        infills.append(infilled)
        complete.append(infilled)
        prompt += completion
    complete.append(parts[-1])

    return infills[0].strip().split("\n")[0]
