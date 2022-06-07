import os
import util
from typing import List

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, StoppingCriteriaList, StoppingCriteria

model_name = "facebook/incoder-1B"
model = AutoModelForCausalLM.from_pretrained(model_name)
tokenizer = AutoTokenizer.from_pretrained(model_name)

CUDA = os.getenv("CODE4ME_CUDA", "False") == "True"
if CUDA:
    model = model.half().cuda()

# signals the start of a document
BOS = "<|endoftext|>"
# signals the end of a generated infill
EOM = "<|endofmask|>"
# signals the end of a file
EOF = "<|/ file |>"
# Until the end of the line
stop_tokens = [205, 284, 353, 536, 994, 3276, 4746, 15471, 16027, 28602, 40289, 43275, 50517]


def make_sentinel(i):
    # signals (1) a location to insert an infill and (2) the start of the infill generation
    return f"<|mask:{i}|>"


class StatementStoppingCriteria(StoppingCriteria):

    def __init__(self, init_length: int, stop_tokens: List[int]):
        self.init_length = init_length
        self.stop_tokens = stop_tokens

    def __contains_stop_token(self, tokens):
        for token in tokens:
            if token in self.stop_tokens:
                return True
        return False

    def __call__(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, **kwargs) -> bool:
        return self.__contains_stop_token(input_ids[0][self.init_length:])


def decode(tokens):
    return tokenizer.decode(
        tokens,
        clean_up_tokenization_spaces=False,
        skip_special_tokens=True
    )


def generate(left_context: str, right_context: str):
    left_context = decode(util.truncate_left_context(
        tokenizer(left_context, return_tensors="pt").input_ids[0],
        1000
    ))
    right_context = decode(util.truncate_right_context(
        tokenizer(right_context, return_tensors="pt").input_ids[0],
        1000
    ))

    prompt = left_context + make_sentinel(0) + right_context + EOF + make_sentinel(1) + make_sentinel(0)
    tokens = tokenizer(prompt, return_tensors="pt")
    if CUDA:
        tokens = tokens.to("cuda")
    token_count = len(tokens.input_ids[0])

    stopping_criteria = StoppingCriteriaList()
    stopping_criteria.append(StatementStoppingCriteria(token_count, stop_tokens))

    with torch.no_grad():
        completion = model.generate(
            **tokens,
            do_sample=True,
            top_p=0.95,
            temperature=0.2,
            max_length=min(2048, token_count + 48),
            stopping_criteria=stopping_criteria
        )[0][token_count:]

    decoded_completion = decode(completion).strip().split("\n")[0]
    return [decoded_completion]
