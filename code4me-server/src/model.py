from enum import Enum
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
