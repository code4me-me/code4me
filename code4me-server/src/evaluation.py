import tokenize
from datetime import datetime
from io import BytesIO

import Levenshtein as Levenshtein
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
from nltk.translate.meteor_score import meteor_score
from rouge_score import rouge_scorer

fix_tokens = {
    tokenize.DEDENT: "DEDENT",
    tokenize.INDENT: "INDENT",
    tokenize.ENDMARKER: "ENDMARKER",
    tokenize.NEWLINE: "NEWLINE",
    tokenize.ENCODING: "",
}


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
    tokens = []
    try:
        tokenized_code = tokenize.tokenize(BytesIO(code.encode('utf-8')).readline)
        for token in tokenized_code:
            if token.type in fix_tokens:
                fixed_token = fix_tokens[token.type]
                if fixed_token != "":
                    tokens.append(fixed_token)
            else:
                tokens.append(token.string)
    except tokenize.TokenError:
        tokens.append(code)  # TODO fix if non compiling code
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
