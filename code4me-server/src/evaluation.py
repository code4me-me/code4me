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


def compute(line: str, completion: str, l):
    tokenized_line, tokenized_line_str = tokenize_code(line, l)
    tokenized_completion, tokenized_completion_str = tokenize_code(completion, l)
    return {
        "bleu": sentence_bleu([tokenized_line], tokenized_completion, smoothing_function=SmoothingFunction().method2),
        "exactMatch": float(line == completion),
        "levenshtein": Levenshtein.ratio(line, completion),
        "meteor": meteor_score(references=[tokenized_line], hypothesis=tokenized_completion),
        "rouge": compute_rouge(tokenized_line_str, tokenized_completion_str),
        "statisticTimestamp": datetime.now().isoformat()
    }


def tokenize_code_python(code):
    tokens = [
        x
        for x in re.split(
            '(\'\'\'(?:.|\n)*\'\'\'|"""(?:.|\n)*"""|"(?:.|\n)*"|\'(?:.|\n)*\'|#.*|!=|\*\*|<<|>>|==|>=|<=| +|\W)',
            code
        )

        if x and not x.isspace()
    ]
    return tokens, " ".join(tokens)


# TODO: add java tokenizer
def tokenize_code_java(code):
    return tokenize_code_python(code)


# TODO: add javascript tokenizer
def tokenize_code_javascript(code):
    return tokenize_code_python(code)


# TODO: add php tokenizer
def tokenize_code_php(code):
    return tokenize_code_python(code)


tokenizer_dict = {
    'python': tokenize_code_python,
    'java': tokenize_code_java,
    'javascript': tokenize_code_javascript,
    'php': tokenize_code_php,
}


def tokenize_code(code, l):
    try:
        return tokenizer_dict[l](code)
    except:
        return tokenizer_dict['python'](code)
