import re
from datetime import datetime

import Levenshtein as Levenshtein
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
from nltk.translate.meteor_score import meteor_score
from rouge_score import rouge_scorer


def compute_rouge(line: str, completion: str):
    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
    scores = scorer.score(line, completion)
    score = scores["rougeL"]

    return {
        "precision": score.precision,
        "recall": score.recall,
        "f1measure": score.fmeasure
    }


def tokenize_code(code):
    tokens = [
        x
        for x in re.split('("""(.|\n)*"""|"(.|\n)*"|#.*|!=|\*\*|<<|>>|==|>=|<=| +|\W)', code)
        if x and not x.isspace()
    ]
    return tokens, " ".join(tokens)


def compute(line: str, completion: str):
    tokenized_line, tokenized_line_str = tokenize_code(line)
    tokenized_completion, tokenized_completion_str = tokenize_code(completion)
    return {
        "bleu": sentence_bleu([tokenized_line], tokenized_completion, smoothing_function=SmoothingFunction().method2),
        "exactMatch": float(line == completion),
        "levenshtein": Levenshtein.ratio(line, completion),
        "meteor": meteor_score(references=[tokenized_line], hypothesis=tokenized_completion),
        "rouge": compute_rouge(tokenized_line_str, tokenized_completion_str),
        "statisticTimestamp": datetime.now().isoformat()
    }
