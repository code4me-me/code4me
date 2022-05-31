from enum import Enum
import incoder


class Model(Enum):
    InCoder = (0, incoder.generate)
    CodeFill = (1, incoder.generate)

    @classmethod
    def _missing_(cls, value):
        if isinstance(value, int):
            for item in cls:
                if item.value[0] == value:
                    return item
        return super()._missing_(value)
