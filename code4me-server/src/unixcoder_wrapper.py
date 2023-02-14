from typing import List
import os

import torch
from unixcoder import UniXcoder

device_name = os.environ.get("UNIXCODER_DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu")
device = torch.device(device_name)
model = UniXcoder("microsoft/unixcoder-base")
model.to(device)

stop_tokens = [
    317, 1022, 2094, 2357, 2830, 2941, 3425, 4148, 4226,
    7204, 7675, 7995, 8292, 12494, 13440, 18149, 18533,
    19134, 19260, 21261, 23648, 29837, 33034, 33593, 33815,
    34180, 35780, 37120, 39622, 41345, 41640, 42768, 47720
]


def generate(left_context: str, right_context: str) -> List[str]:
    tokens_ids = model.tokenize([left_context], max_length=936, mode="<decoder-only>")
    source_ids = torch.tensor(tokens_ids).to(device)
    prediction_ids = model.generate(source_ids, decoder_only=True, beam_size=1, max_length=128, stop_tokens=stop_tokens)
    predictions = model.decode(prediction_ids)
    return [prediction.strip().split("\n")[0] for prediction in predictions[0]]
