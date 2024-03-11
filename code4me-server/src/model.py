import os 
from enum import Enum

# TODO: (revert) remove up to `else:`
if os.getenv("CODE4ME_TEST", "false") == "true":
    print('''
        \033[1m WARNING: RUNNING IN TEST MODE \033[0m
          ''')
    # if the env variable TEST_MODE is set to True, then remap model.generate to lambda: 'model_name'

    incoder = type("InCoder", (object,), {})
    unixcoder_wrapper = type("UniXCoder", (object,), {})
    codegpt = type("CodeGPT", (object,), {})

    incoder.generate = lambda left, right: "incoder"
    unixcoder_wrapper.generate = lambda left, right: "unixcoder"
    codegpt.codegpt_predict = lambda left, right: "codegpt"
else: 
    # ooh yeah, import statements in an else stmt; i see new things every day 
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


class Models(Enum):
    ''' New model enum because I don't want to keep track of indices in my user study - Aral '''

    InCoder     = incoder.generate 
    UniXCoder   = unixcoder_wrapper.generate
    CodeGPT     = codegpt.codegpt_predict
