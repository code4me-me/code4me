import os 
from enum import Enum
from typing import Callable

# NOTE: Convenient for testing, use preset generate functions
# if os.getenv("CODE4ME_TEST", "false") == "true":
#     print('''
#         \033[1m WARNING: RUNNING IN TEST MODE \033[0m
#           ''')
#     # if the env variable TEST_MODE is set to True, then remap model.generate to lambda: 'model_name'

#     incoder = type("InCoder", (object,), {})
#     unixcoder_wrapper = type("UniXCoder", (object,), {})
#     import codegpt 
#     # codegpt = type("CodeGPT", (object,), {})

#     incoder.generate = lambda left, right: ['predict_incoder']
#     unixcoder_wrapper.generate = lambda left, right: [' predict_unixcoder']
    
#     # codegpt.codegpt_predict = lambda left, right: [' (predict_codegpt']
# else: 
#     # ooh yeah, import statements in an else stmt; i see new things every day 
import incoder
import unixcoder_wrapper
import codegpt

class Model(Enum):
    InCoder = (0, incoder.generate)
    UniXCoder = (1, unixcoder_wrapper.generate)
    CodeGPT = (2, codegpt.codegpt_predict)

    @classmethod
    def _missing_(cls, value):
        if isinstance(value, int):
            for item in cls:
                if item.value[0] == value:
                    return item
        return super()._missing_(value)
