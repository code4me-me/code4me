from enum import Enum
import incoder
import unixcoder_wrapper


class Model(Enum):
    InCoder = (0, incoder.generate)
    UniXCoder = (1, unixcoder_wrapper.generate)

    @classmethod
    def _missing_(cls, value):
        if isinstance(value, int):
            for item in cls:
                if item.value[0] == value:
                    return item
        return super()._missing_(value)
