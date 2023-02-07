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
